/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, } from "@api/Commands";
import { MessageDecorationProps } from "@api/MessageDecorations";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import * as Webpack from "@webpack";
import { ChannelStore } from "@webpack/common";

import { handleDisableEncryption, handleRequestEncryption, showErrorNotification } from "./commands";
import { cryptUpload, processOutgoingMessage } from "./crypto";
import { initIcons, openIcon, protocolIcon, safeIcon, unsafeIcon } from "./icons";
import { handleIncomingMessage } from "./protocol";
import { initStorage } from "./storage";

// Signatures
export const PLUGIN_SIGNATURE = "\u200B\u200C\u200D\u200B\u200C";
export const PROTOCOL_REQUEST_SIGNATURE = "\u200B\u200C\u200D\u200B\u200D";
export const PROTOCOL_ACCEPT_SIGNATURE = "\u200B\u200C\u200D\u200C\u200B";
export const PROTOCOL_DISABLE_SIGNATURE = "\u200B\u200C\u200D\u200C\u200C";

export const MAX_MESSAGE_LENGTH = 2000;

let unpatchSend: (() => void) | undefined;
let unsubDispatch: (() => void) | undefined;

export default definePlugin({
    name: "Disencrypt",
    description: "Fully end to end encryption on discord",
    authors: [Devs.tbvns, Devs.dinaru],

    patches: [
        {
            find: "async uploadFiles(",
            replacement: [
                {
                    match: /async uploadFiles\((\i)\){/,
                    replace: "$& await $self.processFiles($1);"
                }
            ],
        }
    ],

    async processFiles(uploads: any) {
        if (!window.pako) return showErrorNotification("❌ Pako is missing, unable to gzip attachments!");

        for (let index = 0; index < uploads.length; index++) {
            const upload = uploads[index];

            console.log("Default file: ", upload.item.file);

            if (upload.currentSize < 2e6) {
                await cryptUpload(upload);

                console.log("New file: ", upload.item.file);
            }
        }
    },

    commands: [
        {
            name: "requestEncryption",
            description: "Request encrypted communication with the current DM partner",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                await handleRequestEncryption(ctx);
            },
        },
        {
            name: "disableEncryption",
            description: "Disable encrypted communication with the current DM partner",
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
        if (ct.endsWith(PROTOCOL_ACCEPT_SIGNATURE) || ct.endsWith(PROTOCOL_DISABLE_SIGNATURE) || ct.endsWith(PROTOCOL_REQUEST_SIGNATURE)) return protocolIcon;
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
                    console.log("[Disencrypt] DM channel selected, scanning for encrypted messages...");

                    // Use the crypto module's scan function
                    const { debouncedScanAndDecrypt } = await import("./crypto");

                    // Wait a bit for messages to render
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
                unsubscribers.push(Dispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onLoadMessages));
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

        const MessageActions: any =
            Webpack.findByProps?.("sendMessage", "editMessage") ||
            Webpack.findByProps?.("sendMessage");

        if (!MessageActions || typeof MessageActions.sendMessage !== "function") {
            console.error("[Disencrypt] Could not locate MessageActions.sendMessage");
            return;
        }

        const originalSend = MessageActions.sendMessage;

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
                        // Process outgoing messages (encryption + signature)
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
            unsubDispatch?.();
        } catch { }
        unsubDispatch = undefined;

        // Stop the mutation observer
        import("./crypto").then(({ stopMessageObserver }) => {
            stopMessageObserver();
        }).catch(() => { });

        console.log("[Disencrypt] stopped");
    },
});
