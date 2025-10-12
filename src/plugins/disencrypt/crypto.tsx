/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore } from "@webpack/common";

import { MAX_MESSAGE_LENGTH, PLUGIN_SIGNATURE, PROTOCOL_ACCEPT_SIGNATURE, PROTOCOL_DISABLE_SIGNATURE,PROTOCOL_REQUEST_SIGNATURE } from "./index";
import { getMyKeys, getUserKeys, MyKeys } from "./storage";

declare const openpgp: any;

async function loadOpenPGP() {
  if (typeof openpgp !== 'undefined') return;
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Use cdn.jsdelivr.net which is allowed by Discord's CSP
    script.src = 'https://cdn.jsdelivr.net/npm/openpgp@5.11.0/dist/openpgp.min.js';
    script.onload = resolve;
    script.onerror = (e) => {
      console.error("[Disencrypt] Failed to load OpenPGP from CDN:", e);
      reject(new Error("OpenPGP loading failed"));
    };
    document.head.appendChild(script);
  });
}

export async function generateKeyPair(): Promise<MyKeys> {
  try {
    await loadOpenPGP();
    
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'ecc',
      curve: 'curve25519',
      userIDs: [{ name: 'Disencrypt User', email: 'user@disencrypt.local' }],
      passphrase: '',
      format: 'armored'
    });

    return { privateKey, publicKey };
  } catch (e) {
    console.error("[Disencrypt] Failed to generate keys:", e);
    throw e;
  }
}

export async function encryptMessage(message: string, recipientPublicKey: string): Promise<string> {
  try {
    await loadOpenPGP();
    
    const publicKey = await openpgp.readKey({ armoredKey: recipientPublicKey });
    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: message }),
      encryptionKeys: publicKey,
      format: 'armored'
    });
    
    return encrypted;
  } catch (e) {
    console.error("[Disencrypt] Encryption failed:", e);
    return message;
  }
}

export async function decryptMessage(encryptedMessage: string): Promise<string> {
  try {
    await loadOpenPGP();
    
    const myKeys = await getMyKeys();
    if (!myKeys) return encryptedMessage;
    
    const privateKey = await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: myKeys.privateKey }),
      passphrase: ''
    });
    
    const message = await openpgp.readMessage({ armoredMessage: encryptedMessage });
    const { data: decrypted } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey
    });
    
    return decrypted;
  } catch (e) {
    console.error("[Disencrypt] Decryption failed:", e);
    return encryptedMessage;
  }
}

export async function processOutgoingMessage(content: string, channelId: string): Promise<string | null> {
  try {
    // Don't process protocol messages or already encrypted messages
    if (
      content.includes("Disencrypt protocol") || 
      content.startsWith("-----BEGIN PGP MESSAGE-----") ||
      content.endsWith(PROTOCOL_REQUEST_SIGNATURE) ||
      content.endsWith(PROTOCOL_ACCEPT_SIGNATURE) ||
      content.endsWith(PROTOCOL_DISABLE_SIGNATURE)
    ) {
      return content;
    }

    // Get DM partner's user ID
    const channel = ChannelStore.getChannel(channelId);
    if (channel?.type !== 1) return content;
    
    const recipientId = channel.recipients?.[0];
    if (!recipientId) return content;

    // Check if we have their public key and encryption is enabled
    const userKeys = await getUserKeys();
    const recipientKey = userKeys[recipientId];
    
    if (recipientKey?.encryptionEnabled && recipientKey.publicKey) {
      console.log("[Disencrypt] Encrypting message for", recipientId);
      const encrypted = await encryptMessage(content, recipientKey.publicKey);
      return encrypted;
    }

    // Add plugin signature to regular messages
    if (content.length + PLUGIN_SIGNATURE.length <= MAX_MESSAGE_LENGTH) {
      if (!content.endsWith(PLUGIN_SIGNATURE)) {
        return content + PLUGIN_SIGNATURE;
      }
    }

    return content;
  } catch (e) {
    console.error("[Disencrypt] Error processing outgoing message:", e);
    return content;
  }
}