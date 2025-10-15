/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { ChannelStore } from "@webpack/common";

import { sendProtocolMessage } from "../utils/protocol";
import { saveUserPreference } from "../utils/storage";

export async function showEncryptionDialog(username: string, userId: string) {
    showNotification({
        title: "Disencrypt Detection",
        body: `${username} is using Disencrypt. Enable encryption?`,
        permanent: true,
        noPersist: false,
        onClick: () => {
            showEncryptionOptionsDialog(username, userId);
        },
    });
}

function showEncryptionOptionsDialog(username: string, userId: string) {
    const notification = document.createElement("div");
    notification.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2f3136;
    border: 2px solid #4f545c;
    border-radius: 12px;
    padding: 24px;
    z-index: 100000;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
    color: #ffffff;
    font-family: Whitney, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 14px;
    min-width: 320px;
    max-width: 400px;
  `;

    notification.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600;">🔒 Disencrypt Detection</h3>
      <p style="margin: 0; color: #b9bbbe; font-size: 14px;">
        <strong>${username}</strong> is using Disencrypt.<br>
        Would you like to enable encryption for this user?
      </p>
    </div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button id="disencrypt-yes" style="padding: 10px 16px; background: #5865f2; border: none; border-radius: 4px; color: white;">Yes</button>
      <button id="disencrypt-no" style="padding: 10px 16px; background: #4f545c; border: none; border-radius: 4px; color: white;">No</button>
      <button id="disencrypt-never" style="padding: 10px 16px; background: #ed4245; border: none; border-radius: 4px; color: white;">Never</button>
    </div>
  `;

    const overlay = document.createElement("div");
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.85);
    z-index: 99999;
  `;

    const closeDialog = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
    };

    const yesBtn = notification.querySelector("#disencrypt-yes");
    const noBtn = notification.querySelector("#disencrypt-no");
    const neverBtn = notification.querySelector("#disencrypt-never");

    yesBtn?.addEventListener("click", async () => {
        await saveUserPreference(userId, "yes");

        const channel = ChannelStore.getChannel(ChannelStore.getDMFromUserId(userId));
        if (channel) {
            await sendProtocolMessage(channel.id, "request");
        }

        showNotification({
            title: "Disencrypt",
            body: `🔐 Encryption request sent to ${username}`,
        });
        closeDialog();
    });

    noBtn?.addEventListener("click", async () => {
        await saveUserPreference(userId, "no");
        closeDialog();
    });

    neverBtn?.addEventListener("click", async () => {
        await saveUserPreference(userId, "never");
        showNotification({
            title: "Disencrypt",
            body: `🚫 Will never ask about ${username} again`,
        });
        closeDialog();
    });

    overlay.addEventListener("click", e => {
        if (e.target === overlay) closeDialog();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeDialog();
    });

    overlay.appendChild(notification);
    document.body.appendChild(overlay);
}
