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
import { ChannelStore, UserStore } from "@webpack/common";

import { handleDisableEncryption, handleRequestEncryption } from "./commands";
import { processOutgoingMessage } from "./crypto";
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

    commands: [
        {
            name: "requestEncryption",
            description: "Request encrypted communication with the current DM partner",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => handleRequestEncryption(ctx)
        },
        {
            name: "disableEncryption",
            description: "Disable encrypted communication with the current DM partner",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => handleDisableEncryption(ctx)
        },
    ],

    renderMessageDecoration: (props: MessageDecorationProps) => {
        if (!props.channel.isPrivate()) return null;

        // TODO: change logistic
        if (!props.message.content.endsWith(PLUGIN_SIGNATURE)) return null;

        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    marginLeft: "6px"
                }}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#25ff00">
                    <path d="M333.4 66.9C329.2 65 324.7 64 320 64C315.3 64 310.8 65 306.6 66.9L118.3 146.8C96.3 156.1 79.9 177.8 80 204C80.5 303.2 121.3 484.7 293.6 567.2C310.3 575.2 329.7 575.2 346.4 567.2C518.8 484.7 559.6 303.2 560 204C560.1 177.8 543.7 156.1 521.7 146.8L333.4 66.9zM313.6 247.5L320 256L326.4 247.5C337.5 232.7 354.9 224 373.3 224C405.7 224 432 250.3 432 282.7L432 288C432 337.1 366.2 386.1 335.5 406.3C326 412.5 314 412.5 304.6 406.3C273.9 386.1 208.1 337 208.1 288L208.1 282.7C208.1 250.3 234.4 224 266.8 224C285.3 224 302.7 232.7 313.7 247.5z" />
                </svg>
                <span style={{ color: "#43b581", fontWeight: 500 }}>Safe</span>
            </div>
        );
    },

    async start() {
        await initStorage();
        console.log("[Disencrypt] started");

        const Dispatcher: any =
            Webpack.findByProps?.("subscribe", "dispatch", "register") ??
            Webpack.findByProps?.("dispatch", "register", "wait");

        if (Dispatcher) {
            const onCreate = async (payload: any) => {
                if (payload?.type !== "MESSAGE_CREATE") return;
                const msg = payload.message;
                if (!msg) return;

                const selfId = UserStore.getCurrentUser()?.id;
                const isNotFromMe = msg.author?.id !== selfId;
                const channel = ChannelStore.getChannel(msg.channel_id);
                const isDM = channel?.type === 1 || channel?.type === 3;

                if (isDM && isNotFromMe) {
                    await handleIncomingMessage(msg);
                }
            };

            if (typeof Dispatcher.subscribe === "function") {
                unsubDispatch = Dispatcher.subscribe("MESSAGE_CREATE", onCreate);
            } else if (typeof Dispatcher.register === "function") {
                const token = Dispatcher.register((payload: any) => {
                    if (payload?.type === "MESSAGE_CREATE") onCreate(payload);
                });
                unsubDispatch = () => {
                    try {
                        Dispatcher.unregister?.(token);
                    } catch { }
                };
            }
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

        console.log("[Disencrypt] stopped");
    },
});
