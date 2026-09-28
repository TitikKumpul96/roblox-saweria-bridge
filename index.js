const express = require("express");

const app = express();

app.use(express.json({
    limit: "1mb"
}));

// ======================================================
// CONFIG
// ======================================================

const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "";

// ======================================================
// TEMPORARY STORAGE
// ======================================================

const donations = new Map();

// ======================================================
// AUTH
// ======================================================

function checkSecret(req) {
    const received = req.headers["x-bridge-secret"];

    return (
        BRIDGE_SECRET &&
        received &&
        received === BRIDGE_SECRET
    );
}

// ======================================================
// HEALTH
// ======================================================

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "roblox-saweria-bridge",
        timestamp: new Date().toISOString(),
        donations: donations.size
    });
});

// ======================================================
// SAWERIA WEBHOOK
// ======================================================

app.post("/webhook/saweria", (req, res) => {

    try {

        console.log("[SAWERIA] Webhook received");

        const body = req.body || {};

        console.log("[SAWERIA] Payload:", body);

        const id = body.id;

        if (!id) {
            return res.status(400).json({
                ok: false,
                error: "Missing donation id"
            });
        }

        // Prevent duplicate donation
        if (donations.has(String(id))) {

            console.log(
                "[SAWERIA] Duplicate donation:",
                id
            );

            return res.json({
                ok: true,
                duplicate: true,
                id: String(id)
            });
        }

        const donation = {

            id: String(id),

            donator_name:
                body.donator_name ||
                body.name ||
                "Anonymous",

            amount_raw:
                Number(body.amount_raw || body.amount || 0),

            message:
                body.message || "",

            created_at:
                body.created_at ||
                new Date().toISOString(),

            type:
                body.type || "donation",

            status: "pending",

            createdAt:
                Date.now(),

            leaseToken: null,

            leaseUntil: 0
        };

        donations.set(
            donation.id,
            donation
        );

        console.log(
            "[SAWERIA] Donation stored:",
            donation
        );

        return res.json({
            ok: true,
            received: true,
            id: donation.id
        });

    } catch (error) {

        console.error(
            "[SAWERIA] Webhook error:",
            error
        );

        return res.status(500).json({
            ok: false,
            error: "Internal server error"
        });
    }
});

// ======================================================
// ROBLOX PULL
// ======================================================

app.post("/api/pull", (req, res) => {

    if (!checkSecret(req)) {

        console.log("[PULL] Unauthorized");

        return res.status(401).json({
            ok: false,
            error: "Unauthorized"
        });
    }

    const serverId =
        req.body?.serverId ||
        "unknown";

    console.log(
        "[PULL] Roblox server:",
        serverId
    );

    const now = Date.now();

    const items = [];

    for (const donation of donations.values()) {

        // Already completed
        if (donation.status === "completed") {
            continue;
        }

        // Currently leased
        if (
            donation.status === "processing" &&
            donation.leaseUntil > now
        ) {
            continue;
        }

        // Lease donation
        const leaseToken =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;

        donation.status = "processing";

        donation.leaseToken = leaseToken;

        donation.leaseUntil =
            now + 30000;

        items.push({

            id: donation.id,

            donator_name:
                donation.donator_name,

            amount_raw:
                donation.amount_raw,

            message:
                donation.message,

            created_at:
                donation.created_at,

            leaseToken:
                leaseToken
        });

        // Prevent too many donations per request
        if (items.length >= 10) {
            break;
        }
    }

    console.log(
        "[PULL] Returning:",
        items.length,
        "donations"
    );

    return res.json({
        items
    });
});

// ======================================================
// ROBLOX ACK
// ======================================================

app.post("/api/ack", (req, res) => {

    if (!checkSecret(req)) {

        console.log("[ACK] Unauthorized");

        return res.status(401).json({
            ok: false,
            error: "Unauthorized"
        });
    }

    const serverId =
        req.body?.serverId ||
        "unknown";

    const items =
        Array.isArray(req.body?.items)
            ? req.body.items
            : [];

    console.log(
        "[ACK] Server:",
        serverId,
        "Items:",
        items.length
    );

    const results = [];

    for (const item of items) {

        const id =
            String(item.id || "");

        const donation =
            donations.get(id);

        if (!donation) {

            results.push({
                id,
                ok: false,
                error: "Donation not found"
            });

            continue;
        }

        if (
            donation.leaseToken !==
            item.leaseToken
        ) {

            results.push({
                id,
                ok: false,
                error: "Invalid leaseToken"
            });

            continue;
        }

        if (item.status === "processed") {

            donation.status =
                "completed";

            donation.processedAt =
                Date.now();

            results.push({
                id,
                ok: true,
                status: "completed"
            });

        } else {

            donation.status =
                "pending";

            donation.leaseToken =
                null;

            donation.leaseUntil =
                0;

            results.push({
                id,
                ok: true,
                status: "returned"
            });
        }
    }

    return res.json({
        ok: true,
        results
    });
});

// ======================================================
// DEBUG STATUS
// ======================================================

app.get("/status", (req, res) => {

    return res.json({
        total: donations.size,

        pending:
            [...donations.values()]
                .filter(x =>
                    x.status === "pending"
                ).length,

        processing:
            [...donations.values()]
                .filter(x =>
                    x.status === "processing"
                ).length,

        completed:
            [...donations.values()]
                .filter(x =>
                    x.status === "completed"
                ).length
    });
});

// ======================================================
// EXPORT FOR VERCEL
// ======================================================

module.exports = app;

// Local development
if (require.main === module) {

    const PORT =
        process.env.PORT || 3000;

    app.listen(PORT, () => {

        console.log(
            `Bridge running on port ${PORT}`
        );

    });
}
