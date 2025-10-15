/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { MessageDecorationProps } from "@api/MessageDecorations";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import * as Webpack from "@webpack";
import { ChannelStore } from "@webpack/common";

import { encryptMessage, loadOpenPGP, processOutgoingMessage } from "./crypto";
import { initIcons, openIcon, protocolIcon, safeIcon, unsafeIcon } from "./ui/icons";
import {
    handleDisableEncryption,
    handleRequestEncryption,
    showErrorNotification,
    showSuccessNotification,
} from "./utils/commands";
import { handleIncomingMessage } from "./utils/protocol";
import { getMyKeys, getUserKeys, initStorage } from "./utils/storage";

// Signatures
export const PLUGIN_SIGNATURE = "\u200B\u200C\u200D\u200B\u200C";
export const PROTOCOL_REQUEST_SIGNATURE = "\u200B\u200C\u200D\u200B\u200D";
export const PROTOCOL_ACCEPT_SIGNATURE = "\u200B\u200C\u200D\u200C\u200B";
export const PROTOCOL_DISABLE_SIGNATURE = "\u200B\u200C\u200D\u200C\u200C";

export const MAX_MESSAGE_LENGTH = 2000;

declare const openpgp: any;
declare const window: any;

let unpatchSend: (() => void) | undefined;
let unpatchAddFiles: (() => void) | undefined;
let unsubDispatch: (() => void) | undefined;

const imgRegex = /\.(jpe?g|png|gif|bmp|webp|svg|tiff?)$/i, vidRegex = /\.(mp4|webm|ogg|mov|avi|mkv|flv|wmv|m4v)$/i, audioRegex = /\.(mp3|wav|ogg|flac|aac|m4a|wma|aiff)$/i;

export default definePlugin({
    name: "Disencrypt",
    description: "Fully end to end encryption on discord",
    authors: [Devs.tbvns, Devs.dinaru],

    dependencies: ["AnonymiseFileNames"],

    attachmentObserver: null as MutationObserver | null,

    startAttachmentObserver() {
        if (this.attachmentObserver) this.stopAttachmentObserver();

        const aggressivelySanitize = () => {
            // Find download buttons by Discord's class patterns and check their href
            document.querySelectorAll('a[href*="cdn.discordapp.com"]').forEach(button => {
                const anchor = button as HTMLAnchorElement;
                const href = anchor.getAttribute("href") || "";

                // Check if this is an encrypted file by looking at the href
                if (href.includes(".txt?") || href.endsWith(".txt")) {
                    const pp = anchor.parentNode?.parentElement;
                    if (!pp || !pp.innerHTML.includes("-----BEGIN PGP MESSAGE-----")) return;

                    if (anchor.getAttribute("data-disencrypt-handled") === "true") return;

                    console.log("[Disencrypt] Sanitizing encrypted download button:", href);

                    // IMMEDIATELY remove target and change href BEFORE any click can happen
                    anchor.removeAttribute("target");
                    anchor.setAttribute("href", "javascript:void(0)");
                    anchor.setAttribute("rel", "noopener noreferrer");
                    anchor.setAttribute("data-disencrypt-handled", "true");

                    // Get the filename from href
                    const filename = href.slice(href.lastIndexOf("/"), href.indexOf("?"));

                    let autoDl: boolean;
                    const cb = () => {
                        pp.removeEventListener("dblclick", cb);
                        pp.removeEventListener("click", cb);
                        this.downloadDecrypted(pp, href, filename, !autoDl).then(preview => preview ? pp.addEventListener("dblclick", cb) : pp.addEventListener("click", cb)).catch((e: any) => {
                            console.error("[Disencrypt] Download failed:", e);
                            showErrorNotification(`Failed to download: ${e.message}`);
                        });

                        autoDl = false;
                    };

                    pp.addEventListener("click", cb);
                    if (pp.innerHTML.includes("%")) {
                        const ext = pp.innerHTML.split("%")[1];
                        if (imgRegex.test(ext) || vidRegex.test(ext) || audioRegex.test(ext)) {
                            autoDl = true;
                            cb();
                        }
                    }
                }
            });
        };

        // Run immediately on start
        aggressivelySanitize();

        this.attachmentObserver = new MutationObserver(mutations => {
            // Check if any of the mutations added nodes with our download buttons
            let shouldScan = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true;
                    break;
                }
            }

            if (shouldScan) aggressivelySanitize();
        });

        this.attachmentObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });

        console.log("[Disencrypt] Aggressive attachment observer started");
    },

    stopAttachmentObserver() {
        this.attachmentObserver?.disconnect();
        this.attachmentObserver = null;
        console.log("[Disencrypt] Attachment observer stopped");
    },

    async downloadDecrypted(pp: HTMLElement, url: string, filename: string, userDl: boolean = false): Promise<void | boolean> {
        try {
            await loadOpenPGP();
            const myKeys = await getMyKeys();
            if (!myKeys) {
                showErrorNotification("❌ Cannot decrypt: no keys found");
                return;
            }

            showSuccessNotification("⏳ Downloading and decrypting...");

            console.log("[Disencrypt] Downloading from:", url);

            // Add before the fetch:
            const HTTP: any = (Webpack as any).findByProps?.("get", "post", "put", "del");
            if (HTTP) {
                const token = getUserTokenSafe();
                url = await refreshCdnUrl(HTTP, token, url);
                console.log("[Disencrypt] Using refreshed URL");
            }

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Accept": "text/plain,*/*",
                    "Sec-Fetch-Mode": "no-cors"
                },
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            // Read as text
            const encryptedText = await response.text();
            const ext = encryptedText.includes("%") ? encryptedText.split("%")[1] : ".txt";

            if (!encryptedText.includes("-----BEGIN PGP MESSAGE-----")) {
                console.log("[Disencrypt] Non-armored response head:", encryptedText.slice(0, 160));
                throw new Error("Link returned non-encrypted content (expired/interstitial)");
            }

            // Decrypt
            const privateKey = await openpgp.readPrivateKey({ armoredKey: myKeys.privateKey });
            const decryptedKey =
                privateKey.isDecrypted() ? privateKey : await openpgp.decryptKey({ privateKey, passphrase: "" });

            const message = await openpgp.readMessage({ armoredMessage: encryptedText.slice(encryptedText.indexOf("-----BEGIN PGP MESSAGE-----")) });
            const { data: compressed } = await openpgp.decrypt({
                message,
                decryptionKeys: decryptedKey,
                format: "binary",
            });

            if (!window.pako) throw new Error("Pako not loaded");
            const decrypted: Uint8Array = window.pako.ungzip(compressed);

            const isImage = imgRegex.test(ext);
            const isVideo = vidRegex.test(ext);
            const isAudio = audioRegex.test(ext);

            const preview = isImage || isAudio || isVideo;

            // Save
            const blobUrl = URL.createObjectURL(new Blob([decrypted]));
            if (isImage) pp.innerHTML = `<img src="${blobUrl}" alt="Decrypted Image"></img>`;
            if (isVideo) pp.innerHTML = `<video controls alt="Decrypted Video"><source src="${blobUrl}" type="video/${ext.slice(1)}">Error</video>`;
            if (isAudio) pp.innerHTML = `<audio controls alt="Decrypted Audio"><source src="${blobUrl}" type="audio/${ext.slice(1)}">Error</audio>`;

            if (!preview || userDl) {
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = filename.slice(0, filename.indexOf(".")) + ext;
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                }, 100);
            }

            showSuccessNotification("✅ File decrypted and downloaded!");
            return preview;
        } catch (e: any) {
            console.error("[Disencrypt] Failed:", e);
            showErrorNotification(`❌ Failed: ${e.message}`);
        }
    },

    // Helper: determine if something is a File
    isFile(x: any): x is File {
        return (
            x &&
            typeof x === "object" &&
            typeof x.name === "string" &&
            typeof x.size === "number" &&
            typeof x.type === "string" &&
            typeof x.arrayBuffer === "function"
        );
    },

    // Helper: extract File from various shapes used internally
    extractFile(x: any): File | null {
        try {
            if (this.isFile(x)) return x;
            if (this.isFile(x?.file)) return x.file;
            if (this.isFile(x?.item?.file)) return x.item.file;
            if (this.isFile(x?._file)) return x._file;
            if (this.isFile(x?._originalFile)) return x._originalFile;

            if (x?.blob instanceof Blob && typeof x?.filename === "string") {
                return new File([x.blob], x.filename, {
                    type: x.blob.type || "application/octet-stream",
                });
            }
            return null;
        } catch {
            return null;
        }
    },

    // Helper: rebuild list preserving original shape while swapping Files
    rebuildArrayWithFiles(inputArr: any[], outFiles: File[]) {
        const isFile = (f: any) => this.isFile(f);
        // 1) Raw File[]
        if (inputArr.every(isFile)) {
            return outFiles;
        }
        // 2) [{ file }]
        if (inputArr.every(x => isFile(x?.file))) {
            return outFiles.map((f, i) => ({ ...inputArr[i], file: f }));
        }
        // 3) [{ item: { file } }]
        if (inputArr.every(x => isFile(x?.item?.file))) {
            return outFiles.map((f, i) => ({
                ...inputArr[i],
                item: { ...(inputArr[i]?.item ?? {}), file: f },
            }));
        }
        // 4) [{ attachment: { file } }]
        if (inputArr.every(x => isFile(x?.attachment?.file))) {
            return outFiles.map((f, i) => ({
                ...inputArr[i],
                attachment: { ...(inputArr[i]?.attachment ?? {}), file: f },
            }));
        }
        // 5) [{ data: { file } }]
        if (inputArr.every(x => isFile(x?.data?.file))) {
            return outFiles.map((f, i) => ({
                ...inputArr[i],
                data: { ...(inputArr[i]?.data ?? {}), file: f },
            }));
        }
        // 6) [{ blob, filename }]
        if (
            inputArr.every(
                x => x?.blob instanceof Blob && typeof x?.filename === "string"
            )
        ) {
            return outFiles.map((f, i) => ({
                ...inputArr[i],
                blob: new Blob([f], { type: f.type }),
                filename: f.name,
            }));
        }

        console.warn(
            "[Disencrypt] Unknown files array shape in UploadAttachmentStore.addFiles; leaving unchanged"
        );
        return inputArr;
    },

    tryPatchUploadAttachmentStore() {
        try {
            console.log("[Disencrypt] Setting up file upload interceptor...");

            const Dispatcher = Webpack.findByProps?.("subscribe", "dispatch") ||
                Webpack.findByProps?.("_dispatch", "_actionHandlers");

            if (!Dispatcher) {
                console.error("[Disencrypt] Could not find Flux Dispatcher");
                return;
            }

            console.log("[Disencrypt] Found Flux Dispatcher, patching dispatch...");

            const originalDispatch = Dispatcher.dispatch.bind(Dispatcher);
            const self = this;

            Dispatcher.dispatch = function (payload: any) {
                // Only intercept file upload events
                if (payload?.type === "UPLOAD_ATTACHMENT_ADD_FILES") {
                    console.log("[Disencrypt] Intercepting file upload...");

                    const processAsync = async () => {
                        try {
                            const { channelId, files } = payload;
                            const channel = ChannelStore.getChannel(channelId);

                            if (!Array.isArray(files) || files?.length < 1 || channel?.type !== 1 || !window.pako) {
                                return originalDispatch(payload);
                            }

                            const recipientId = channel.recipients?.[0];
                            if (!recipientId) return originalDispatch(payload);

                            const userKeys = await getUserKeys();
                            const recipientKey = userKeys[recipientId];

                            if (!recipientKey?.publicKey) return originalDispatch(payload);

                            console.log("[Disencrypt] Encrypting files...");

                            // Encrypt all files
                            for (let i = 0; i < files.length; i++) {
                                const fileItem = files[i];
                                const file = self.extractFile(fileItem);

                                if (!file) continue;

                                console.log(`[Disencrypt] Encrypting: ${file.name} (${file.size} bytes)`);

                                try {
                                    const gz = window.pako.gzip?.(await file.arrayBuffer());
                                    if (!gz) return originalDispatch(payload);

                                    const enc = await encryptMessage(gz, recipientKey.publicKey);
                                    const text = typeof enc === "string" ? enc : new TextDecoder().decode(enc);

                                    const encryptedFile = new File([`%${file.name.slice(file.name.lastIndexOf("."))}%\n` + text], file.name + ".txt", {
                                        type: "text/plain",
                                        lastModified: Date.now(),
                                    });

                                    console.log(`[Disencrypt] Created encrypted file: ${encryptedFile.name} (${encryptedFile.size} bytes)`);

                                    // Update the file reference
                                    if (fileItem.file) {
                                        fileItem.file = encryptedFile;
                                        console.log("[Disencrypt] Updated fileItem.file");
                                    }
                                    if (fileItem.item && typeof fileItem.item === "object") {
                                        fileItem.item.file = encryptedFile;
                                        fileItem.item.platform = 1;
                                        console.log("[Disencrypt] Updated fileItem.item.file");
                                    }
                                } catch (e) {
                                    console.error(`[Disencrypt] Failed to encrypt ${file.name}:`, e);
                                }
                            }

                            console.log("[Disencrypt] Dispatching with encrypted files");
                            return originalDispatch(payload);
                        } catch (e) {
                            console.error("[Disencrypt] Error:", e);
                            return originalDispatch(payload);
                        }
                    };

                    // Run async but don't wait
                    processAsync();

                    // Don't dispatch yet - let the async function do it
                    return;
                }

                // For all other events, dispatch normally
                return originalDispatch(payload);
            };

            unpatchAddFiles = () => {
                try {
                    Dispatcher.dispatch = originalDispatch;
                    console.log("[Disencrypt] Restored dispatch");
                } catch { }
            };

            console.log("[Disencrypt] ✓ Installed");
        } catch (e) {
            console.error("[Disencrypt] Failed:", e);
        }
    },

    commands: [
        {
            name: "requestEncryption",
            description:
                "Request encrypted communication with the current DM partner",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                await handleRequestEncryption(ctx);
            },
        },
        {
            name: "disableEncryption",
            description:
                "Disable encrypted communication with the current DM partner",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                await handleDisableEncryption(ctx);
            },
        },
    ],

    renderMessageDecoration: (props: MessageDecorationProps) => {
        if (!props.channel.isPrivate()) return null;

        const ct = props.message.content;
        if (ct.endsWith(PLUGIN_SIGNATURE)) return openIcon;
        if (
            ct.endsWith(PROTOCOL_ACCEPT_SIGNATURE) ||
            ct.endsWith(PROTOCOL_DISABLE_SIGNATURE) ||
            ct.endsWith(PROTOCOL_REQUEST_SIGNATURE)
        )
            return protocolIcon;
        if (ct.startsWith("-----BEGIN PGP MESSAGE-----")) return safeIcon;

        return unsafeIcon;
    },

    async start() {
        console.log("[Disencrypt] Starting..");

        initIcons();

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js";
        script.onload = () => console.log("[Disencrypt] pako loaded");
        script.onerror = e => console.error("[Disencrypt] Failed to load pako:", e);
        document.head.appendChild(script);

        await initStorage();

        // Webpack patches
        this.tryPatchUploadAttachmentStore();

        // Global capture-phase click interceptor
        // this._boundGlobalClickHandler = this.globalEncryptedClickHandler.bind(this);
        // document.addEventListener("click", this._boundGlobalClickHandler, true);

        // ALSO intercept mousedown as a safety net
        // document.addEventListener("mousedown", this._boundGlobalClickHandler, true);

        // AND intercept auxclick (middle-click, etc.)
        // document.addEventListener("auxclick", this._boundGlobalClickHandler, true);

        this.startAttachmentObserver();

        console.log("[Disencrypt] Started!");

        const Dispatcher: any =
            Webpack.findByProps?.("subscribe", "dispatch", "register") ??
            Webpack.findByProps?.("dispatch", "register", "wait");

        if (Dispatcher) {
            // Handle new messages
            const onCreate = async (payload: any) => {
                if (payload?.type !== "MESSAGE_CREATE") return;
                const msg = payload.message;
                if (!msg) return;

                const channel = ChannelStore.getChannel(msg.channel_id);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM) {
                    await handleIncomingMessage(msg);
                }
            };

            // Handle channel switching
            const onChannelSelect = async (payload: any) => {
                if (payload?.type !== "CHANNEL_SELECT") return;

                const { channelId } = payload;
                if (!channelId) return;

                const channel = ChannelStore.getChannel(channelId);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM) {
                    console.log(
                        "[Disencrypt] DM channel selected, scanning for encrypted messages..."
                    );
                    const { debouncedScanAndDecrypt } = await import("./crypto");
                    setTimeout(() => {
                        debouncedScanAndDecrypt(300);
                    }, 500);
                }
            };

            // Handle message updates (edits, etc)
            const onMessageUpdate = async (payload: any) => {
                if (payload?.type !== "MESSAGE_UPDATE") return;
                const msg = payload.message;
                if (!msg) return;

                const channel = ChannelStore.getChannel(msg.channel_id);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM) {
                    await handleIncomingMessage(msg);
                }
            };

            // Handle load messages (when scrolling up)
            const onLoadMessages = async (payload: any) => {
                if (payload?.type !== "LOAD_MESSAGES_SUCCESS") return;

                const channel = ChannelStore.getChannel(payload.channelId);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM) {
                    console.log("[Disencrypt] Messages loaded, scanning...");
                    const { debouncedScanAndDecrypt } = await import("./crypto");
                    debouncedScanAndDecrypt(300);
                }
            };

            const unsubscribers: Array<(() => void) | undefined> = [];

            if (typeof Dispatcher.subscribe === "function") {
                unsubscribers.push(Dispatcher.subscribe("MESSAGE_CREATE", onCreate));
                unsubscribers.push(Dispatcher.subscribe("CHANNEL_SELECT", onChannelSelect));
                unsubscribers.push(Dispatcher.subscribe("MESSAGE_UPDATE", onMessageUpdate));
                unsubscribers.push(
                    Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onLoadMessages)
                );
            } else if (typeof Dispatcher.register === "function") {
                const token = Dispatcher.register((payload: any) => {
                    if (payload?.type === "MESSAGE_CREATE") onCreate(payload);
                    else if (payload?.type === "CHANNEL_SELECT") onChannelSelect(payload);
                    else if (payload?.type === "MESSAGE_UPDATE") onMessageUpdate(payload);
                    else if (payload?.type === "LOAD_MESSAGES_SUCCESS") onLoadMessages(payload);
                });
                unsubscribers.push(() => {
                    try {
                        Dispatcher.unregister?.(token);
                    } catch { }
                });
            }

            unsubDispatch = () => {
                unsubscribers.forEach(unsub => {
                    try {
                        unsub?.();
                    } catch { }
                });
            };
        }

        // Patch message sending (text)
        const MessageActions: any =
            Webpack.findByProps?.("sendMessage", "editMessage") ||
            Webpack.findByProps?.("sendMessage");

        if (!MessageActions || typeof MessageActions.sendMessage !== "function") {
            console.error("[Disencrypt] Could not locate MessageActions.sendMessage");
            return;
        }

        const originalSend = MessageActions.sendMessage;

        const self = this;

        MessageActions.sendMessage = async function patchedSendMessage(
            channelId: string,
            message: any,
            ...rest: any[]
        ) {
            try {
                const channel = ChannelStore.getChannel(channelId);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM && message && typeof message === "object") {
                    const content: string = message.content ?? "";
                    if (typeof content === "string" && content.length > 0) {
                        const processed = await processOutgoingMessage(content, channelId);
                        if (processed === null) {
                            return; // Cancel message sending
                        }
                        if (processed !== content) {
                            message = { ...message, content: processed };
                        }
                    }
                }
            } catch (e) {
                console.error("[Disencrypt] sendMessage hook error", e);
            }
            return originalSend.call(this, channelId, message, ...rest);
        };

        unpatchSend = () => {
            try {
                if (MessageActions.sendMessage !== originalSend) {
                    MessageActions.sendMessage = originalSend;
                }
            } catch { }
        };

        // Initial scan when plugin starts
        console.log("[Disencrypt] Performing initial message scan...");
        const { scanAndDecryptMessages, startMessageObserver } = await import("./crypto");
        setTimeout(() => {
            scanAndDecryptMessages();
            startMessageObserver();
        }, 2000);
    },

    stop() {
        try {
            unpatchSend?.();
        } catch { }
        unpatchSend = undefined;

        try {
            unpatchAddFiles?.();
        } catch { }
        unpatchAddFiles = undefined;

        try {
            unsubDispatch?.();
        } catch { }
        unsubDispatch = undefined;

        import("./crypto")
            .then(({ stopMessageObserver }) => {
                stopMessageObserver();
            })
            .catch(() => { });

        // Remove global click interceptor
        try {
            if (this._boundGlobalClickHandler) {
                document.removeEventListener("click", this._boundGlobalClickHandler, true);
                document.removeEventListener("mousedown", this._boundGlobalClickHandler, true);
                document.removeEventListener("auxclick", this._boundGlobalClickHandler, true);
            }
        } catch { }

        // Stop observer
        this.stopAttachmentObserver();

        console.log("[Disencrypt] stopped");
    },
});

function getAnchorFromEventPath(ev: Event): HTMLAnchorElement | null {
    const path = (ev as any).composedPath?.() || [];
    for (const node of path) {
        if (node && (node as Element).nodeType === 1) {
            const el = node as Element;
            if (el.tagName === "A") return el as HTMLAnchorElement;
            const a = el.querySelector?.("a");
            if (a) return a as HTMLAnchorElement;
        }
    }
    // Fallback traverse
    let t = ev.target as Element | null;
    while (t && t !== document.body) {
        if (t.tagName === "A") return t as HTMLAnchorElement;
        t = t.parentElement;
    }
    return null;
}

function sanitizeEncryptedAnchor(a: HTMLAnchorElement) {
    // Remove real navigation
    a.setAttribute("href", "javascript:void(0)");
    a.removeAttribute("target");
    a.setAttribute("rel", "noopener");
    // Mark to avoid duplicate handlers
    a.setAttribute("data-disencrypt-handled", "true");
}

function getUserTokenSafe(): string | undefined {
    try {
        // Discord stores token JSON under a key ending with "token"
        const key = Object.keys(localStorage).find(k => /token$/i.test(k));
        if (!key) return undefined;
        const raw = localStorage.getItem(key);
        if (!raw) return undefined;

        // Often it's a JSON string like {"token":"..."}
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.token === "string" && parsed.token.length > 10) {
                return parsed.token;
            }
        } catch {
            // Sometimes it's plain token
            if (typeof raw === "string" && raw.length > 10) return raw;
        }
    } catch { }
    return undefined;
}

async function httpGetText(HTTP: any, url: string): Promise<string> {
    const res = await HTTP.get({ url, retries: 1 });
    // superagent Response: prefer .text
    if (typeof res?.text === "string") return res.text;
    if (typeof res?.body === "string") return res.body;
    // Some builds put string in res.req?.responseText
    const maybe = (res as any)?.req?.xhr?.responseText;
    if (typeof maybe === "string") return maybe;
    throw new Error("Could not read text response");
}

async function refreshCdnUrl(HTTP: any, token: string | undefined, url: string): Promise<string> {
    // Try attachment_urls/refreshed_urls first (most common currently)
    try {
        const r1 = await HTTP.post({
            url: "/attachments/refresh-urls",
            body: { attachment_urls: [url] },
            headers: token ? { Authorization: token } : undefined,
            oldFormErrors: true,
        });
        const refreshed1 = r1?.body?.refreshed_urls?.[0]?.refreshed;
        if (typeof refreshed1 === "string") return refreshed1;
    } catch (e) {
        console.warn("[Disencrypt] refresh-urls (attachment_urls) failed", e);
    }

    // Fallback: older shape urls/refreshed
    try {
        const r2 = await HTTP.post({
            url: "/attachments/refresh-urls",
            body: { urls: [url] },
            headers: token ? { Authorization: token } : undefined,
            oldFormErrors: true,
        });
        const refreshed2 = r2?.body?.refreshed?.[0]?.refreshed;
        if (typeof refreshed2 === "string") return refreshed2;
    } catch (e) {
        console.warn("[Disencrypt] refresh-urls (urls) failed", e);
    }

    // If both fail, return original
    return url;
}
