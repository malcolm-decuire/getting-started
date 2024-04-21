/**
 * This code is used in Flatfile's Custom App Tutorial
 * https://flatfile.com/docs/apps/custom
 *
 * To see all of Flatfile's code examples go to: https://github.com/FlatFilers/flatfile-docs-kitchen-sink
 */

import { FlatfileListener } from "@flatfile/listener";
import { recordHook, FlatfileRecord } from "@flatfile/plugin-record-hook";
import { Client, FlatfileEvent } from "@flatfile/listener";
import api, { Flatfile } from "@flatfile/api";
import axios from "axios";

import { dedupePlugin } from "@flatfile/plugin-dedupe";
import { PhoneNumberUtil } from "google-libphonenumber";
import { execSync } from "child_process";
import * as R from "remeda";
import * as path from "path";

// TODO: Update this with your webhook.site URL for Part 4
const webhookReceiver = process.env.WEBHOOK_SITE_URL || "YOUR_WEBHOOK_URL";

export default function flatfileEventListener(listener: Client) {
  // Part 1: Setup a listener (https://flatfile.com/docs/apps/custom/meet-the-listener)
  listener.on("**", (event: FlatfileEvent) => {
    // Log all events
    console.log(`Received event: ${event.topic}`);
  });

  listener.namespace(["space:red"], (red: FlatfileListener) => {
    // Part 2: Automate space creation
    const scriptPath = path.resolve("./scripts/create-workbook.sh");
    console.log(`Script path resolved to: ${scriptPath}`);

    try {
      const output = execSync(`bash ${scriptPath}`, { encoding: "utf-8" });
      console.log(output);
    } catch (error) {
      console.error("Error running create-workbook.sh:", error.message);
      console.error("Stack Trace:", error.stack);
    }

    // Part 3: Transform and validate (https://flatfile.com/docs/apps/custom/add-data-transformation)
    red.use(
      recordHook("contacts", (record: FlatfileRecord) => {
        // Validate and transform a Record's first name
        const value = record.get("firstName");
        if (typeof value === "string") {
          record.set("firstName", value.toLowerCase());
        } else {
          record.addError("firstName", "Invalid first name");
        }

        // Validate a Record's email address
        const email = record.get("email") as string;
        const validEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!validEmailAddress.test(email)) {
          console.log("Invalid email address");
          record.addError("email", "Invalid email address");
        }

        // Validate a Record's phone number
        const phoneNumber = record.get("phoneNumber") as string;
        const phoneUtil = PhoneNumberUtil.getInstance();
        try {
          const parsedPhoneNumber = phoneUtil.parse(phoneNumber, "US");
          if (!phoneUtil.isValidNumber(parsedPhoneNumber)) {
            record.addError("phoneNumber", "Invalid phone number");
          }
        } catch (error) {
          record.addError("phoneNumber", "Invalid phone number");
        }

        return record;
      }) as any
    );

    // Part 4: Configure a submit Action (https://flatfile.com/docs/apps/custom/submit-action)
    red
      .filter({ job: "workbook:submitAction" })
      .on("job:ready", async (event: FlatfileEvent) => {
        const { context, payload } = event;
        const { jobId, workbookId } = context;

        // Acknowledge the job
        try {
          await api.jobs.ack(jobId, {
            info: "Starting job to submit action to webhook.site",
            progress: 10,
          });

          //get the input data
          const job = await api.jobs.get(jobId);
          const priority = job.data.input["string"];
          console.log("priority");
          console.log(priority);

          // Collect all Sheet and Record data from the Workbook
          const { data: sheets } = await api.sheets.list({ workbookId });
          const records: { [name: string]: any } = {};
          for (const [index, element] of sheets.entries()) {
            records[`Sheet[${index}]`] = await api.records.get(element.id);
          }

          console.log(JSON.stringify(records, null, 2));

          // Send the data to our webhook.site URL
          const response = await axios.post(
            webhookReceiver,
            {
              ...payload,
              method: "axios",
              sheets,
              records,
              priority,
            },
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          );

          // If the call fails throw an error
          if (response.status !== 200) {
            throw new Error("Failed to submit data to webhook.site");
          }

          // Otherwise, complete the job
          await api.jobs.complete(jobId, {
            outcome: {
              message: `Data was successfully submitted to Webhook.site. Go check it out at ${webhookReceiver}.`,
            },
          });
        } catch (error) {
          // If an error is thrown, fail the job
          console.log(`webhook.site[error]: ${JSON.stringify(error, null, 2)}`);
          await api.jobs.fail(jobId, {
            outcome: {
              message: `This job failed. Check your ${webhookReceiver}.`,
            },
          });
        }
      });

    // Part 5: Dedupe Records
    //red.use(dedupePlugin('dedupeRecords', { on: "email", keep: "last", debug: true }));
  });
}
