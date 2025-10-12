/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin, { PluginDef } from "@utils/types";
import * as Webpack from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

import { handleDisableEncryption,handleRequestEncryption } from "./commands";
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
          } catch {}
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
      } catch {}
    };
  },

  stop() {
    try {
      unpatchSend?.();
    } catch {}
    unpatchSend = undefined;

    try {
      unsubDispatch?.();
    } catch {}
    unsubDispatch = undefined;

    console.log("[Disencrypt] stopped");
  },
});