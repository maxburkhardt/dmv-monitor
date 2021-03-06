import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import request, { RequestPromiseOptions } from "request-promise";
import { parse, HTMLElement } from "node-html-parser";
import twilio from "twilio";

admin.initializeApp();
const db = admin.firestore();

async function getDmvPage(): Promise<string> {
  const options: RequestPromiseOptions = {
    baseUrl: "https://www.dmv.ca.gov",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/83.0.4103.61 Safari/537.36",
    },
  };
  const response = await request(
    "/portal/covid-19-relief-information/",
    options
  );
  return response;
}

async function getDmvUpdates(source: string): Promise<Array<string>> {
  const parsed = parse(source);
  let pressReleaseSection: HTMLElement | null = null;
  for (const element of parsed.querySelectorAll(".content-columns")) {
    let isCorrectSection = false;
    for (const h2Element of element.querySelectorAll("h2")) {
      if (h2Element.rawText === "Press Releases") {
        isCorrectSection = true;
      }
    }
    if (isCorrectSection) {
      pressReleaseSection = element;
    }
  }
  if (pressReleaseSection === null) {
    throw new Error("Couldn't find press release section!");
  } else {
    return pressReleaseSection.querySelectorAll("a").map((link) => {
      return link.rawText;
    });
  }
}

async function sendNotification(newArticle: string): Promise<void> {
  console.log("Sending a notification!");
  const twilioClient = twilio(
    functions.config().twilio.sid,
    functions.config().twilio.token
  );
  await twilioClient.messages.create({
    body: `New release detected: ${newArticle}`,
    from: functions.config().twilio.fromnumber,
    to: functions.config().twilio.tonumber,
  });
}

export const monitorDmv = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async (_context) => {
    const latest = db.collection("pressReleases").doc("latest");
    const page = await getDmvPage();
    const releases = await getDmvUpdates(page);
    const retrieved = await latest.get();
    if (retrieved.exists) {
      const data = retrieved.data();
      if (data !== undefined && data.latest[0] !== releases[0]) {
        await sendNotification(releases[0]);
        await latest.set({ latest: releases });
      }
    } else {
      await latest.set({ latest: releases });
    }
  });
