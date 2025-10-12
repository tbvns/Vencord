import { PLUGIN_SIGNATURE, MAX_MESSAGE_LENGTH, PROTOCOL_REQUEST_SIGNATURE, PROTOCOL_ACCEPT_SIGNATURE, PROTOCOL_DISABLE_SIGNATURE } from "./index";
import { getUserKeys, getMyKeys, saveMyKeys, MyKeys } from "./storage";
import { ChannelStore } from "@webpack/common";

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

// Helper function to strip all invisible signature characters
function stripInvisibleChars(text: string): string {
    return text
        .replace(/\u200B/g, '') // Zero-width space
        .replace(/\u200C/g, '') // Zero-width non-joiner
        .replace(/\u200D/g, ''); // Zero-width joiner
}


export async function decryptMessage(encryptedMessage: string, messageId?: string): Promise<string> {
    try {
        await loadOpenPGP();

        // Strip any invisible signature characters
        const cleanedMessage = stripInvisibleChars(encryptedMessage).trim();

        const myKeys = await getMyKeys();
        if (!myKeys) return encryptedMessage;

        // Read the private key
        const privateKey = await openpgp.readPrivateKey({ armoredKey: myKeys.privateKey });

        // Check if the key is already decrypted (no passphrase)
        let decryptedKey;
        if (privateKey.isDecrypted()) {
            decryptedKey = privateKey;
            console.log("[Disencrypt] Private key is already decrypted");
        } else {
            decryptedKey = await openpgp.decryptKey({
                privateKey: privateKey,
                passphrase: ''
            });
            console.log("[Disencrypt] Decrypted private key with passphrase");
        }

        const message = await openpgp.readMessage({ armoredMessage: cleanedMessage });
        const { data: decrypted } = await openpgp.decrypt({
            message,
            decryptionKeys: decryptedKey
        });

        console.log("[Disencrypt] Decryption successful:", decrypted);

        // If messageId is provided, replace in DOM
        if (messageId) {
            await replaceEncryptedMessageInDOM(messageId, encryptedMessage, decrypted);
        }

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


export async function replaceEncryptedMessageInDOM(messageId: string, encryptedContent: string, decryptedContent: string) {
    try {
        // Find the message element
        const messageElement = document.querySelector(`[id^="chat-messages-"][id$="-${messageId}"]`) ||
            document.querySelector(`#message-content-${messageId}`) ||
            document.querySelector(`[data-message-id="${messageId}"]`);

        if (!messageElement) {
            console.warn("[Disencrypt] Could not find message element for ID:", messageId);
            return;
        }

        // Find the content container (the actual text part of the message)
        const contentContainer = messageElement.querySelector('[class*="messageContent"]') ||
            messageElement.querySelector('[class*="markup"]') ||
            messageElement.querySelector('div[class*="content"]');

        if (!contentContainer) {
            console.warn("[Disencrypt] Could not find content container");
            return;
        }

        // Store original content
        const originalHTML = contentContainer.innerHTML;

        // Create wrapper for decrypted content
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position: relative;';

        // Create decrypted content element
        const decryptedDiv = document.createElement('div');
        decryptedDiv.className = 'disencrypt-decrypted-content';
        decryptedDiv.style.cssText = `
            color: #dcddde;
            line-height: 1.375rem;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
        decryptedDiv.textContent = decryptedContent;

        // Create encrypted content element (hidden by default)
        const encryptedDiv = document.createElement('div');
        encryptedDiv.className = 'disencrypt-encrypted-content';
        encryptedDiv.style.cssText = `
            display: none;
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
            max-height: 200px;
            overflow-y: auto;
        `;
        encryptedDiv.textContent = encryptedContent;

        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'disencrypt-toggle-btn';
        toggleBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #b9bbbe;
            cursor: pointer;
            padding: 2px 4px;
            margin-left: 8px;
            font-size: 12px;
            vertical-align: middle;
            transition: color 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        `;
        toggleBtn.innerHTML = '🔒 <span style="font-size: 10px;">▼</span>';
        toggleBtn.title = 'Show encrypted message';

        // Add lock icon and badge
        const lockBadge = document.createElement('span');
        lockBadge.style.cssText = `
            display: inline-block;
            background: linear-gradient(135deg, #43aa8b, #57f287);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            margin-left: 8px;
            vertical-align: middle;
        `;
        lockBadge.textContent = '🔒 ENCRYPTED';

        let isShowingEncrypted = false;

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isShowingEncrypted = !isShowingEncrypted;

            if (isShowingEncrypted) {
                encryptedDiv.style.display = 'block';
                toggleBtn.innerHTML = '🔒 <span style="font-size: 10px;">▲</span>';
                toggleBtn.title = 'Hide encrypted message';
            } else {
                encryptedDiv.style.display = 'none';
                toggleBtn.innerHTML = '🔒 <span style="font-size: 10px;">▼</span>';
                toggleBtn.title = 'Show encrypted message';
            }
        });

        toggleBtn.addEventListener('mouseenter', () => {
            toggleBtn.style.color = '#ffffff';
        });

        toggleBtn.addEventListener('mouseleave', () => {
            toggleBtn.style.color = '#b9bbbe';
        });

        // Build the new content
        wrapper.appendChild(decryptedDiv);
        wrapper.appendChild(lockBadge);
        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(encryptedDiv);

        // Replace the content
        contentContainer.innerHTML = '';
        contentContainer.appendChild(wrapper);

        console.log("[Disencrypt] Successfully replaced encrypted message in DOM");

    } catch (e) {
        console.error("[Disencrypt] Failed to replace message in DOM:", e);
    }
}

export async function scanAndDecryptMessages() {
    try {
        console.log("[Disencrypt] Scanning for encrypted messages...");

        // Find all message elements in the DOM
        const messageElements = document.querySelectorAll('[class*="message-"]');

        let decryptedCount = 0;

        for (const element of Array.from(messageElements)) {
            try {
                // Skip if already processed
                if (element.querySelector('.disencrypt-decrypted-content')) {
                    continue;
                }

                // Find the content container
                const contentContainer = element.querySelector('[class*="messageContent"]') ||
                    element.querySelector('[class*="markup"]');

                if (!contentContainer) continue;

                const textContent = contentContainer.textContent || '';

                // Check if it's an encrypted message
                if (textContent.startsWith("-----BEGIN PGP MESSAGE-----") &&
                    textContent.includes("-----END PGP MESSAGE-----")) {

                    // Extract message ID from the element
                    const messageId = element.id?.split('-').pop() ||
                        element.getAttribute('data-message-id') ||
                        `temp-${Date.now()}-${Math.random()}`;

                    console.log(`[Disencrypt] Found encrypted message: ${messageId}`);

                    // Decrypt and replace
                    const decrypted = await decryptMessage(textContent, messageId);

                    if (decrypted !== textContent) {
                        decryptedCount++;
                    }
                }
            } catch (e) {
                console.error("[Disencrypt] Error processing message:", e);
            }
        }

        if (decryptedCount > 0) {
            console.log(`[Disencrypt] Decrypted ${decryptedCount} messages`);
        }

    } catch (e) {
        console.error("[Disencrypt] Failed to scan messages:", e);
    }
}

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
