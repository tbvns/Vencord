/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import * as Webpack from "@webpack";

import { generateKeyPair } from "./crypto";
import {
    PLUGIN_SIGNATURE,
    PROTOCOL_ACCEPT_SIGNATURE,
    PROTOCOL_DISABLE_SIGNATURE,
    PROTOCOL_REQUEST_SIGNATURE,
} from "./index";
import {
  disableUserEncryption,
  getMyKeys,
  getUserPreference,
  saveMyKeys,
  saveUserKey,
} from "./storage";
import { showEncryptionDialog } from "./ui";

export async function sendProtocolMessage(
  channelId: string,
  type: "request" | "accept" | "disable"
) {
  try {
    // Ensure we have keys
    let myKeys = await getMyKeys();
    if (!myKeys && type !== "disable") {
      console.log("[Disencrypt] Generating new keypair...");
      myKeys = await generateKeyPair();
      await saveMyKeys(myKeys);
    }

    let signature: string;
    let protocolMessage: string;

    if (type === "disable") {
      signature = PROTOCOL_DISABLE_SIGNATURE;
      protocolMessage = `----------------
Disencrypt protocol
if you see this, enable the disencrypt extension.
State: Encryption disabled
----------------
Encryption has been disabled for this conversation.${signature}`;
    } else {
      const state =
        type === "request" ? "Requesting encryption" : "Accepting encryption";
      signature =
        type === "request"
          ? PROTOCOL_REQUEST_SIGNATURE
          : PROTOCOL_ACCEPT_SIGNATURE;

      protocolMessage = `----------------
Disencrypt protocol
if you see this, enable the disencrypt extension.
State: ${state}
----------------
${myKeys!.publicKey}${signature}`;
    }

    console.log("[Disencrypt] Sending protocol message:", {
      type,
      channelId,
      messageLength: protocolMessage.length
    });

    // Use MessageActions to send the message
    const MessageActions =
      Webpack.findByProps?.("sendMessage", "editMessage") ||
      Webpack.findByProps?.("sendMessage");

    if (!MessageActions?.sendMessage) {
      throw new Error("MessageActions.sendMessage not available");
    }

    // Split message if it exceeds Discord's limit
    const chunks: string[] = [];
    const limit = 1990;
    for (let i = 0; i < protocolMessage.length; i += limit) {
      chunks.push(protocolMessage.slice(i, i + limit));
    }

    console.log(`[Disencrypt] Sending ${chunks.length} message chunk(s)`);

    // Send each chunk with proper parameters
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Disencrypt] Sending chunk ${i + 1}/${chunks.length}`);

      // Create proper message object with all required fields
      const messageData = {
        content: chunk,
        tts: false,
        invalidEmojis: [],
        validNonShortcutEmojis: [],
      };

      // sendMessage typically expects: (channelId, message, extraParams, promiseCallbacks)
      await new Promise((resolve, reject) => {
        try {
          MessageActions.sendMessage(
            channelId,
            messageData,
            undefined, // extraParams
            {
              resolve,
              reject
            }
          );
        } catch (e) {
          reject(e);
        }
      });

      // Add small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log("[Disencrypt] Protocol message sent successfully");

    showNotification({
      title: "Disencrypt",
      body:
        type === "disable"
          ? "🔓 Encryption disabled for this conversation"
          : "🔐 Encryption handshake message sent!",
    });
  } catch (err: any) {
    console.error("[Disencrypt] Failed to send protocol message:", err);
    console.error("[Disencrypt] Details:", {
      type,
      channelId,
      error: err?.message,
      stack: err?.stack,
    });

    showNotification({
      title: "Disencrypt",
      body: `❌ Failed to send protocol message: ${err?.message || err}`,
    });
  }
}

export async function handleIncomingMessage(msg: any) {
  const content = msg.content ?? "";
  const userId = msg.author?.id;
  const username = msg.author?.username ?? "Unknown";

  // Handle disable encryption
  if (content.endsWith(PROTOCOL_DISABLE_SIGNATURE)) {
    console.log(`[Disencrypt] Received encryption disable from ${username}`);
    if (userId) {
      await disableUserEncryption(userId);
      showNotification({
        title: "Disencrypt",
        body: `🔓 ${username} disabled encryption`,
      });
    }
    return;
  }

  // Handle encryption request
  if (content.endsWith(PROTOCOL_REQUEST_SIGNATURE)) {
    console.log(`[Disencrypt] Received encryption request from ${username}`);
    const publicKeyMatch = content.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/);
    if (publicKeyMatch && userId) {
      const publicKey = publicKeyMatch[0];
      await saveUserKey(userId, publicKey);

      // Send acceptance message
      await sendProtocolMessage(msg.channel_id, 'accept');

      showNotification({
        title: "Disencrypt",
        body: `🔐 Encryption enabled with ${username}`,
      });
    }
    return;
  }

  // Handle encryption acceptance
  if (content.endsWith(PROTOCOL_ACCEPT_SIGNATURE)) {
    console.log(`[Disencrypt] Received encryption acceptance from ${username}`);
    const publicKeyMatch = content.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/);
    if (publicKeyMatch && userId) {
      const publicKey = publicKeyMatch[0];
      await saveUserKey(userId, publicKey);

      showNotification({
        title: "Disencrypt",
        body: `✅ ${username} accepted encryption!`,
      });
    }
    return;
  }

  // Handle regular plugin detection
  if (content.endsWith(PLUGIN_SIGNATURE)) {
    console.log(`[Disencrypt] ${username} is using Disencrypt plugin!`);

    if (userId) {
      const existingPref = await getUserPreference(userId);
      if (existingPref === undefined) {
        console.log(`[Disencrypt] New user ${username}, showing notification`);
        await showEncryptionDialog(username, userId);
      }
    }

    const cleanContent = content.slice(0, -PLUGIN_SIGNATURE.length);
    console.log(`[Disencrypt] DM from ${username}: ${cleanContent}`);
    return;
  }

  // Try to decrypt encrypted messages
  if (content.startsWith("-----BEGIN PGP MESSAGE-----")) {
    console.log(`[Disencrypt] Attempting to decrypt message from ${username}`);
    const { decryptMessage } = await import('./crypto');
    const decrypted = await decryptMessage(content);
    if (decrypted !== content) {
      console.log(`[Disencrypt] Decrypted message: ${decrypted}`);
    }
  }
}
