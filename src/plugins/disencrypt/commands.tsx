/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CommandContext, CommandReturnValue } from "@vencord/discord-types";
import { Promisable } from "type-fest/source/promisable";

import { sendProtocolMessage } from "./protocol";
import { disableUserEncryption, saveUserPreference } from "./storage";

function showNotification(content: string, color1: string, color2: string) {
    const notification = document.createElement("div");
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, ${color1}, ${color2});
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        z-index: 1000000;
        font-family: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 8px 16px rgba(0,0,0,0.24);
        max-width: 300px;
        animation: slideIn 0.3s ease;
    `;

    const style = document.createElement("style");
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    if (!document.head.contains(style)) document.head.appendChild(style);

    notification.textContent = content;
    document.body.appendChild(notification);

    setTimeout(() => {
        if (!document.body.contains(notification)) return;
        notification.style.animation = "slideIn 0.3s ease reverse";

        setTimeout(() => document.body.contains(notification) ? document.body.removeChild(notification) : null, 300);
    }, 4000);
}

function showSuccessNotification(content: string) {
    console.log(`[Disencrypt] ${content}`);

    showNotification(content, "#57f287", "#43aa8b");
}

function showErrorNotification(content: string) {
    console.error(`[Disencrypt] ${content}`);

    showNotification(content, "#ed4245", "#c53030");
}

export function handleRequestEncryption(ctx: CommandContext): Promisable<void | CommandReturnValue> {
    try {
        console.log("[Disencrypt] handleRequestEncryption called with:", ctx);

        console.log("[Disencrypt] Channel info:", ctx.channel);

        if (ctx.channel.type !== 1) return showErrorNotification("❌ Encryption commands can only be used in DMs");

        const recipientId = ctx.channel.recipients?.[0];
        if (!recipientId) return showErrorNotification("❌ Could not find recipient");

        console.log(`[Disencrypt] Processing requestEncryption for recipient: ${recipientId}`);

        // Save preference and send protocol request
        saveUserPreference(recipientId, "yes");
        console.log("[Disencrypt] Saved preference, now sending protocol message...");

        sendProtocolMessage(ctx.channel.id, "request");
        console.log("[Disencrypt] Protocol message sent");

        showSuccessNotification("🔐 Encryption request sent!");

    } catch (e) {
        console.error("[Disencrypt] Request encryption command error:", e);
        showErrorNotification(`❌ Failed to request encryption: ${e.message}`);
    }
}

export function handleDisableEncryption(ctx: CommandContext): Promisable<void | CommandReturnValue> {
    try {
        console.log("[Disencrypt] handleDisableEncryption called with:", ctx);

        if (ctx.channel.type !== 1) return showErrorNotification("❌ Encryption commands can only be used in DMs");

        const recipientId = ctx.channel.recipients?.[0];
        if (!recipientId) return showErrorNotification("❌ Could not find recipient");

        console.log(`[Disencrypt] Processing disableEncryption for recipient: ${recipientId}`);

        // Disable encryption and send notification
        disableUserEncryption(recipientId);
        sendProtocolMessage(ctx.channel.id, "disable");

        showSuccessNotification("🔓 Encryption disabled for this conversation");
    } catch (e) {
        console.error("[Disencrypt] Disable encryption command error:", e);
        showErrorNotification(`❌ Failed to disable encryption: ${e.message}`);
    }
}
