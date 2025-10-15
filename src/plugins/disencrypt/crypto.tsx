/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CloudUpload } from "@vencord/discord-types";
import { ChannelStore } from "@webpack/common";

import { MAX_MESSAGE_LENGTH, PLUGIN_SIGNATURE, PROTOCOL_ACCEPT_SIGNATURE, PROTOCOL_DISABLE_SIGNATURE, PROTOCOL_REQUEST_SIGNATURE } from "./index";
import { getMyKeys, getUserKeys, MyKeys } from "./utils/storage";

declare const openpgp: any;

export async function loadOpenPGP() {
    if (typeof openpgp !== "undefined") return;

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        // Use cdn.jsdelivr.net which is allowed by Discord's CSP
        script.src = "https://cdn.jsdelivr.net/npm/openpgp@5.11.0/dist/openpgp.min.js";
        script.onload = resolve;
        script.onerror = e => {
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
            type: "ecc",
            curve: "curve25519",
            userIDs: [{ name: "Disencrypt User", email: "user@disencrypt.local" }],
            passphrase: "",
            format: "armored"
        });

        return { privateKey, publicKey };
    } catch (e) {
        console.error("[Disencrypt] Failed to generate keys:", e);
        throw e;
    }
}

export async function encryptMessage(msg: string | Uint8Array, recipientPublicKey: string): Promise<string | Uint8Array> {
    try {
        await loadOpenPGP();

        const myKeys = await getMyKeys();
        if (!myKeys) {
            console.error("[Disencrypt] Cannot encrypt: no keys found");
            return msg;
        }

        const recipientKey = await openpgp.readKey({ armoredKey: recipientPublicKey });
        const myPublicKey = await openpgp.readKey({ armoredKey: myKeys.publicKey });
        const message = msg instanceof Uint8Array ? await openpgp.createMessage({ binary: msg }) : await openpgp.createMessage({ text: msg });

        const encrypted = await openpgp.encrypt({
            message,
            encryptionKeys: [recipientKey, myPublicKey], // Encrypt for both parties
            format: "armored"
        });

        console.log("[Disencrypt] Message encrypted for both sender and recipient");
        return encrypted;
    } catch (e) {
        console.error("[Disencrypt] Encryption failed:", e);
        return msg;
    }
}

// Helper function to strip all invisible signature characters
function stripInvisibleChars(text: string): string {
    return text
        .replace(/\u200B/g, "")
        .replace(/\u200C/g, "")
        .replace(/\u200D/g, "");
}

export async function decryptMessage(encryptedMessage: string, messageId?: string): Promise<string> {
    try {
        await loadOpenPGP();

        const cleanedMessage = stripInvisibleChars(encryptedMessage).trim();

        const myKeys = await getMyKeys();
        if (!myKeys) {
            console.warn("[Disencrypt] Cannot decrypt: no keys found");
            return encryptedMessage;
        }

        const privateKey = await openpgp.readPrivateKey({ armoredKey: myKeys.privateKey });

        let decryptedKey: any;
        if (privateKey.isDecrypted()) {
            decryptedKey = privateKey;
        } else {
            decryptedKey = await openpgp.decryptKey({
                privateKey: privateKey,
                passphrase: ""
            });
        }

        const message = await openpgp.readMessage({ armoredMessage: cleanedMessage });

        const { data: decrypted } = await openpgp.decrypt({
            message,
            decryptionKeys: decryptedKey
        });

        console.log("[Disencrypt] Decryption successful");

        if (messageId) {
            await replaceEncryptedMessageInDOM(messageId, encryptedMessage, decrypted);
        }

        return decrypted;
    } catch (e) {
        console.error("[Disencrypt] Decryption failed:", e);

        if (e instanceof Error && e.message.includes("Session key decryption failed")) {
            console.warn("[Disencrypt] This message was not encrypted for your key");
        }

        return encryptedMessage;
    }
}

export async function cryptUpload(upload: CloudUpload) {
    console.log("[Disencrypt] cryptUpload called with:", upload);

    const channel = ChannelStore.getChannel(upload.channelId);
    console.log("[Disencrypt] Channel:", channel);

    if (channel?.type !== 1) {
        console.log("[Disencrypt] Not a DM channel, skipping encryption");
        return;
    }

    const recipientId = channel.recipients?.[0];
    console.log("[Disencrypt] Recipient ID:", recipientId);

    if (!recipientId) {
        console.log("[Disencrypt] No recipient found");
        return;
    }

    const userKeys = await getUserKeys();
    console.log("[Disencrypt] User keys:", userKeys);

    const recipientKey = userKeys[recipientId];
    console.log("[Disencrypt] Recipient key:", recipientKey);

    if (!recipientKey?.publicKey) {
        console.log("[Disencrypt] No public key for recipient, skipping encryption");
        return;
    }

    if (!recipientKey.encryptionEnabled) {
        console.log("[Disencrypt] Encryption not enabled for this user");
        return;
    }

    console.log("[Disencrypt] Starting file encryption...");

    try {
        const buffer = await upload.item.file.arrayBuffer();
        console.log("[Disencrypt] File buffer size:", buffer.byteLength);

        const compressed: Uint8Array = window.pako.gzip(buffer);
        console.log("[Disencrypt] Compressed size:", compressed.length);

        const encrypted = await encryptMessage(compressed, recipientKey.publicKey);
        console.log("[Disencrypt] Encrypted, type:", typeof encrypted);

        // Ensure encrypted is a string (armored text)
        const encryptedText =
            typeof encrypted === "string"
                ? encrypted
                : new TextDecoder().decode(encrypted as Uint8Array);

        console.log("[Disencrypt] Encrypted text length:", encryptedText.length);
        console.log("[Disencrypt] First 100 chars:", encryptedText.substring(0, 100));

        // Create as text/plain so Discord serves it correctly
        const attachment = new File([encryptedText], upload.filename + "-de", {
            type: "text/plain",
        });

        console.log("[Disencrypt] Created encrypted file:", attachment.name, attachment.size);

        upload.filename += "-de";
        upload.mimeType = "text/plain";
        upload.item.file = attachment;

        console.log("[Disencrypt] Upload object updated successfully");
    } catch (e) {
        console.error("[Disencrypt] Encryption failed:", e);
    }
}

export async function processOutgoingMessage(content: string, channelId: string): Promise<string | Uint8Array | null> {
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


export async function replaceEncryptedMessageInDOM(messageId: string, encryptedContent: string, decryptedContent: string) {
    try {
        // Try multiple strategies to find the message element
        let messageElement = document.querySelector(`#chat-messages-${messageId}`) ||
            document.querySelector(`[id$="-${messageId}"]`) ||
            document.querySelector(`[data-list-item-id="chat-messages-${messageId}"]`) ||
            document.querySelector(`[data-message-id="${messageId}"]`);

        // If still not found, search through all messages
        if (!messageElement) {
            const allMessages = document.querySelectorAll('[id^="chat-messages-"]');
            for (const msg of Array.from(allMessages)) {
                if (msg.id.endsWith(messageId)) {
                    messageElement = msg;
                    break;
                }
            }
        }

        if (!messageElement) {
            console.warn("[Disencrypt] Could not find message element for ID:", messageId);
            return;
        }

        console.log("[Disencrypt] Found message element:", messageElement.id || messageElement.className);

        // Find the content container (the actual text part of the message)
        const contentContainer = messageElement.querySelector('[class*="messageContent"]') ||
            messageElement.querySelector('[class*="markup"]') ||
            messageElement.querySelector('[id^="message-content-"]') ||
            messageElement.querySelector('div[class*="content-"]');

        if (!contentContainer) {
            console.warn("[Disencrypt] Could not find content container");
            return;
        }

        console.log("[Disencrypt] Found content container, replacing content...");

        // Create wrapper for decrypted content
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "position: relative;";
        wrapper.className = "disencrypt-wrapper";

        // Create decrypted content element
        const decryptedDiv = document.createElement("div");
        decryptedDiv.className = "disencrypt-decrypted-content";
        decryptedDiv.style.cssText = `
            color: #dcddde;
            line-height: 1.375rem;
            white-space: pre-wrap;
            word-wrap: break-word;
            margin-bottom: 0.5rem;
        `;
        decryptedDiv.textContent = decryptedContent;

        // Create encrypted content element (hidden by default)
        const encryptedDiv = document.createElement("div");
        encryptedDiv.className = "disencrypt-encrypted-content";
        encryptedDiv.style.cssText = `
            display: none;
            overflow-y: auto;
            max-height: 0;
            opacity: 0;
            transition: max-height 0.4s ease, opacity 0.4s ease;
            color: #72767d;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.375rem;
            white-space: pre-wrap;
            word-wrap: break-word;
            background: #2f3136;
            padding: 8px;
            border-radius: 4px;
            margin-top: 4px;
        `;
        encryptedDiv.textContent = encryptedContent;

        // Create toggle button
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "disencrypt-toggle-btn";
        toggleBtn.style.cssText = `
            align-items: center;
            display: inline-flex;
            background: linear-gradient(135deg, #33777a, #37a267);
            color: #c9ccce;
            transition: color 0.2s;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 600;
            vertical-align: middle;
        `;
        toggleBtn.innerHTML = '🔒 Show encrypted content <span style="font-size: 10px;">▼</span>';

        let isShowingEncrypted = false;

        toggleBtn.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            isShowingEncrypted = !isShowingEncrypted;

            if (isShowingEncrypted) {
                encryptedDiv.style.display = "block";
                setTimeout(() => {
                    encryptedDiv.style.opacity = "1";
                    encryptedDiv.style.maxHeight = "300px";
                }, 10);
                toggleBtn.innerHTML = '🔒 Hide encrypted content <span style="font-size: 10px;">▲</span>';
            } else {
                setTimeout(() => encryptedDiv.style.display = "none", 500);
                encryptedDiv.style.opacity = "0";
                encryptedDiv.style.maxHeight = "0";
                toggleBtn.innerHTML = '🔒 Show encrypted content <span style="font-size: 10px;">▼</span>';
            }
        });

        toggleBtn.addEventListener("mouseenter", () => {
            toggleBtn.style.color = "#ffffff";
        });

        toggleBtn.addEventListener("mouseleave", () => {
            toggleBtn.style.color = "#b9bbbe";
        });

        // Build the new content
        wrapper.appendChild(decryptedDiv);
        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(encryptedDiv);

        // Replace the content
        contentContainer.innerHTML = "";
        contentContainer.appendChild(wrapper);

        console.log("[Disencrypt] Successfully replaced encrypted message in DOM");

    } catch (e) {
        console.error("[Disencrypt] Failed to replace message in DOM:", e);
    }
}

// Add this function to scan and decrypt all messages in the current view
export async function scanAndDecryptMessages() {
    try {
        console.log("[Disencrypt] Scanning for encrypted messages...");

        // Try multiple selectors to find message elements
        const possibleSelectors = [
            '[id^="chat-messages-"]',
            '[class*="message-"]',
            'li[id^="chat-messages-"]',
            '[class*="messageListItem"]',
            '[data-list-item-id^="chat-messages"]'
        ];

        let messageElements: Element[] = [];

        for (const selector of possibleSelectors) {
            const elements = Array.from(document.querySelectorAll(selector));
            if (elements.length > 0) {
                messageElements = elements;
                console.log(`[Disencrypt] Found ${elements.length} messages using selector: ${selector}`);
                break;
            }
        }

        if (messageElements.length === 0) {
            console.warn("[Disencrypt] No message elements found");
            return;
        }

        let decryptedCount = 0;
        let encryptedFound = 0;

        for (const element of messageElements) {
            try {
                // Skip if already processed
                if (element.querySelector(".disencrypt-decrypted-content")) {
                    continue;
                }

                // Try multiple selectors for content
                const contentContainer = element.querySelector('[class*="messageContent"]') ||
                    element.querySelector('[class*="markup"]') ||
                    element.querySelector('[id^="message-content-"]') ||
                    element.querySelector('div[class*="content-"]');

                if (!contentContainer) continue;

                const textContent = contentContainer.textContent || "";

                // Check if it's an encrypted message
                if (textContent.includes("-----BEGIN PGP MESSAGE-----") &&
                    textContent.includes("-----END PGP MESSAGE-----")) {

                    encryptedFound++;

                    // Extract message ID from the element
                    let messageId = element.id?.split("-").pop();

                    if (!messageId) {
                        // Try to find it in data attributes
                        messageId = element.getAttribute("data-list-item-id")?.split("-").pop() ||
                            element.getAttribute("data-message-id") ||
                            `temp-${Date.now()}-${Math.random()}`;
                    }

                    console.log(`[Disencrypt] Found encrypted message: ${messageId}`);
                    console.log(`[Disencrypt] First 100 chars: ${textContent.substring(0, 100)}`);

                    // Extract just the PGP message
                    const pgpMatch = textContent.match(/(-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----)/);
                    if (pgpMatch) {
                        const encryptedText = pgpMatch[1];

                        // Decrypt and replace
                        const decrypted = await decryptMessage(encryptedText, messageId);

                        if (decrypted !== encryptedText) {
                            decryptedCount++;
                            console.log(`[Disencrypt] Successfully decrypted message ${messageId}`);
                        } else {
                            console.warn(`[Disencrypt] Failed to decrypt message ${messageId}`);
                        }
                    }
                }
            } catch (e) {
                console.error("[Disencrypt] Error processing message:", e);
            }
        }

        console.log(`[Disencrypt] Scan complete. Found ${encryptedFound} encrypted messages, decrypted ${decryptedCount}`);

    } catch (e) {
        console.error("[Disencrypt] Failed to scan messages:", e);
    }
}

// Add a MutationObserver to catch dynamically loaded messages
let messageObserver: MutationObserver | null = null;

export function startMessageObserver() {
    // Stop existing observer if any
    stopMessageObserver();

    // Find the messages container
    const messagesContainer = document.querySelector('[class*="messagesWrapper"]') ||
        document.querySelector('[class*="scroller"][class*="messages"]') ||
        document.querySelector('[data-list-id="chat-messages"]');

    if (!messagesContainer) {
        console.warn("[Disencrypt] Could not find messages container for observer");
        return;
    }

    console.log("[Disencrypt] Starting message observer");

    messageObserver = new MutationObserver(mutations => {
        let shouldScan = false;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // Check if any added nodes are message elements
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof Element) {
                        const isMessage = node.id?.startsWith("chat-messages-") ||
                            node.classList?.toString().includes("message") ||
                            node.querySelector?.('[class*="messageContent"]');

                        if (isMessage) {
                            shouldScan = true;
                            break;
                        }
                    }
                }
            }
            if (shouldScan) break;
        }

        if (shouldScan) {
            debouncedScanAndDecrypt(200);
        }
    });

    messageObserver.observe(messagesContainer, {
        childList: true,
        subtree: true
    });
}

export function stopMessageObserver() {
    if (messageObserver) {
        messageObserver.disconnect();
        messageObserver = null;
        console.log("[Disencrypt] Stopped message observer");
    }
}

// Add a debounced version to avoid excessive scanning
let scanTimeout: NodeJS.Timeout | null = null;
export function debouncedScanAndDecrypt(delay: number = 500) {
    if (scanTimeout) {
        clearTimeout(scanTimeout);
    }
    scanTimeout = setTimeout(() => {
        scanAndDecryptMessages();
        scanTimeout = null;
    }, delay);
}
