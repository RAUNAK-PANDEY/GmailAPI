const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}


//Function to check new Emails
async function checkForNewEmails(auth) {
  const gmail = google.gmail({ version: "v1", auth });

  const response = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
  });

  const messages = response.data.messages;
  //   console.log(response.data)

  if (messages && messages.length > 0) {
    // Process the list of unread messages
    for (const message of messages) {
      const email = await getEmailDetails(message.id, auth);
      // console.log(email)
      // Check if the email has no prior replies
      const sender = email.payload.headers.find(
        (header) => header.name.toLowerCase() === "from"
      ).value;
      //   console.log("Sender:", sender);
      const hasPriorReplies = await checkPriorReplies(email, auth);
      //   console.log(hasPriorReplies);
      if (!hasPriorReplies) {
        // Send reply
        //   console.log(email)
        sendReply(email, sender, auth);
      }
    }
  }
}
authorize().then(checkForNewEmails).catch(console.error);


//Function to find email details
async function getEmailDetails(messageId, auth) {
  const gmail = google.gmail({ version: "v1", auth });

  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });

  const email = response.data;
  //   console.log(email);
  return email;
}

//Check Threads
async function checkPriorReplies(email, auth) {
  const gmail = google.gmail({ version: "v1", auth });

  // Retrieve the email thread
  const response = await gmail.users.threads.get({
    userId: "me",
    id: email.threadId,
  });

  const thread = response.data;

  // Check if the thread has any replies
  if (thread.messages.length > 1) {
    // The thread has prior replies
    return true;
  }

  // The thread has no prior replies
  return false;
}

//Function to send Reply
async function sendReply(email, sender, auth) {
  const gmail = google.gmail({ version: "v1", auth });

  const message = await createReplyMessage(email, sender, auth);
 
  // Add label and move the email to the label
  const lebel = await addLabelToEmail(email, "autoreply", auth);
}

//Function for Creating Reply 
async function createReplyMessage(email, sender, auth) {
  const gmail = google.gmail({ version: "v1", auth });
  const subject = email.payload.headers.find(
    (header) => header.name.toLowerCase() === "subject"
  ).value;

  const replySubject = `Re: ${subject}`;
  const replyContent = `Thank you for your email. I am currently out of the office and will respond to your message as soon as possible.`;
  //   console.log(replySubject);

  const message = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: createRawMessage(replySubject, replyContent, sender),
    },
  });

  return message.data;
}

//Creating Message format to be sent
function createRawMessage(subject, content, email) {
  const emailLines = [];

  emailLines.push(`From: Raunak Pandey <raunakpandey0007@gmail.com>`);
  emailLines.push(`To: ${email}`);
  emailLines.push(`Subject: ${subject}`);
  emailLines.push(`Content-Type: text/plain; charset="UTF-8"`);
  emailLines.push(`Content-Transfer-Encoding: quoted-printable`);
  emailLines.push(``);
  emailLines.push(content);

  return Buffer.from(emailLines.join("\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

//Adding Label to the emails
async function addLabelToEmail(email, labelName, auth) {
  const gmail = google.gmail({ version: "v1", auth });
  
  const labels = await gmail.users.labels.list({
    userId: "me",
  });
  //   console.log(labels)
  const existingLabel = labels.data.labels.find(
    (label) => label.name === labelName
  );
    console.log(existingLabel)
  const labelId = existingLabel
    ? existingLabel.id
    : await createLabel(labelName, auth);

//   console.log(labelId)
  await gmail.users.messages.modify({
    userId: "me",
    id: email.id,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds: [],
    },
  });
}

//Creating labels
async function createLabel(labelName, auth) {
  const gmail = google.gmail({ version: "v1", auth });

  const response = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  const labelId = response.data.id;
  return labelId;
}

//Auto Reply Function
function startAutoReply() {
  const minInterval = 45 * 1000; // 45 seconds
  const maxInterval = 120 * 1000; // 120 seconds

  function checkAndReply() {
    // Implement the logic to check for new emails and send auto-reply
    checkForNewEmails();

    // Calculate the next interval
    const interval =
      Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;

    // Set the timeout for the next auto-reply
    setTimeout(checkAndReply, interval);
  }

  // Start the auto-reply process
  checkAndReply();
}

startAutoReply();
