/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { JSX } from "react";

export let safeIcon: JSX.Element, openIcon: JSX.Element, unsafeIcon: JSX.Element, protocolIcon: JSX.Element;

export function initIcons() {
    safeIcon = (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "6px"
            }}
            title="This message is secured using PGP"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#0e8200">
                <path d="M333.4 66.9C329.2 65 324.7 64 320 64C315.3 64 310.8 65 306.6 66.9L118.3 146.8C96.3 156.1 79.9 177.8 80 204C80.5 303.2 121.3 484.7 293.6 567.2C310.3 575.2 329.7 575.2 346.4 567.2C518.8 484.7 559.6 303.2 560 204C560.1 177.8 543.7 156.1 521.7 146.8L333.4 66.9zM313.6 247.5L320 256L326.4 247.5C337.5 232.7 354.9 224 373.3 224C405.7 224 432 250.3 432 282.7L432 288C432 337.1 366.2 386.1 335.5 406.3C326 412.5 314 412.5 304.6 406.3C273.9 386.1 208.1 337 208.1 288L208.1 282.7C208.1 250.3 234.4 224 266.8 224C285.3 224 302.7 232.7 313.7 247.5z" />
            </svg>
            <span style={{ color: "#43b581", fontWeight: 500 }}>Safe</span>
        </div>
    );

    openIcon = (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "6px"
            }}
            title="This message is unsafe, but the user has disencrypt"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="gold">
                <path d="M416 160C416 124.7 444.7 96 480 96C515.3 96 544 124.7 544 160L544 192C544 209.7 558.3 224 576 224C593.7 224 608 209.7 608 192L608 160C608 89.3 550.7 32 480 32C409.3 32 352 89.3 352 160L352 224L192 224C156.7 224 128 252.7 128 288L128 512C128 547.3 156.7 576 192 576L448 576C483.3 576 512 547.3 512 512L512 288C512 252.7 483.3 224 448 224L416 224L416 160z" />
            </svg>
            <span style={{ color: "orange", fontWeight: 500 }}>Open</span>
        </div>
    );

    unsafeIcon = (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "6px"
            }}
            title="This message is unsafe"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="#ff4444">
                <path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z" />
            </svg>
            <span style={{ color: "#ff0000", fontWeight: 500 }}>Unsafe</span>
        </div>
    );

    protocolIcon = (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "6px"
            }}
            title="This is a protocol message, you are not supposed to see it"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="16" height="16" fill="slateblue">
                <path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM216 128C202.7 128 192 138.7 192 152C192 165.3 202.7 176 216 176L264 176C277.3 176 288 165.3 288 152C288 138.7 277.3 128 264 128L216 128zM216 224C202.7 224 192 234.7 192 248C192 261.3 202.7 272 216 272L264 272C277.3 272 288 261.3 288 248C288 234.7 277.3 224 264 224L216 224zM286.3 384C275 384 264.4 389.1 257.4 397.9L197.3 473C189 483.3 190.7 498.5 201 506.7C211.3 514.9 226.5 513.3 234.7 502.9L281.8 444.1L297 494.8C300 505 309.4 511.9 320 511.9L424 511.9C437.3 511.9 448 501.2 448 487.9C448 474.6 437.3 463.9 424 463.9L337.9 463.9L321.8 410.3C317.1 394.6 302.7 383.9 286.3 383.9z" />
            </svg>
            <span style={{ color: "rebeccapurple", fontWeight: 500 }}>Protocol</span>
        </div>
    );
}
