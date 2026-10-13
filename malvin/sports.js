// malvin/sports.js — NO-KEY version (no MALVIN_API_KEY needed)
// Backends: TheSportsDB free tier (players, teams, tables, fixtures,
// livescore, h2h search) + BBC Sport RSS (news). All free, no key.
// Honest limits: topscorers show top attacking TEAMS (no free player
// scorers feed exists without a key); odds show fixtures + note.

const { mxd } = require("../king");
const axios = require("axios");
const cheerio = require("cheerio");
const { sendButtons } = require("malvin-btns");
const { fancy } = require("../king/fancyFont");

const AX = axios.create({ timeout: 15000, validateStatus: () => true });
const DB = "https://www.thesportsdb.com/api/v1/json/3";

function extractButtonId(msg) {
    if (!msg) return null;
    if (msg.templateButtonReplyMessage?.selectedId)
        return msg.templateButtonReplyMessage.selectedId;
    if (msg.buttonsResponseMessage?.selectedButtonId)
        return msg.buttonsResponseMessage.selectedButtonId;
    if (msg.listResponseMessage?.singleSelectReply?.selectedRowId)
        return msg.listResponseMessage.singleSelectReply.selectedRowId;
    if (msg.interactiveResponseMessage) {
        const nf = msg.interactiveResponseMessage.nativeFlowResponseMessage;
        if (nf?.paramsJson) {
            try { const p = JSON.parse(nf.paramsJson); if (p.id) return p.id; } catch (e) {}
        }
        return msg.interactiveResponseMessage.buttonId || null;
    }
    return null;
}

// Current season string for lookuptable (seasons start in August).
function currentSeason() {
    const now = new Date();
    const y = now.getUTCFullYear();
    return now.getUTCMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const LEAGUES = {
    epl:        { id: "4328", name: "English Premier League" },
    bundesliga: { id: "4331", name: "German Bundesliga" },
    laliga:     { id: "4335", name: "Spanish La Liga" },
    seriea:     { id: "4332", name: "Italian Serie A" },
    ligue1:     { id: "4334", name: "French Ligue 1" },
    ucl:        { id: "4480", name: "UEFA Champions League" },
    euros:      { id: "4553", name: "UEFA European Championship" },
    fifa:       { id: "4429", name: "FIFA World Cup" },
};

// ==================== PLAYER SEARCH ====================
mxd(
    {
        pattern: "player",
        category: "sports",
        react: "⚽",
        aliases: ["footballplayer", "soccerplayer"],
        description: "Search for football players",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react, botName, botFooter } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a player name\n\n*Example:* .player Messi");
        }
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/searchplayers.php?p=${encodeURIComponent(q.trim())}`);
            const players = (data?.player || []).slice(0, 5);
            if (!players.length) {
                await react("❌");
                return reply("No players found.");
            }
            const p = players[0];
            const dateNow = Date.now();
            const message = `⚽ *PLAYER SEARCH*\n🔍 ${fancy("search", "smallcaps")}: ${q}\n✅ ${fancy("found", "smallcaps")}: ${players.length}\n\n👤 *${p.strPlayer}*\n🏟️ Team: ${p.strTeam || "N/A"}\n🌍 Nationality: ${p.strNationality || "N/A"}\n📅 Born: ${p.dateBorn || "N/A"}\n📏 Height: ${p.strHeight || "N/A"} | ⚖️ Weight: ${p.strWeight || "N/A"}\n⚽ Position: ${p.strPosition || "N/A"}\n📝 ${(p.strDescriptionEN || "").slice(0, 300)}`;
            await sendButtons(Malvin, from, {
                title: botName, text: message, footer: `> *${botFooter}*`,
                ...(p.strThumb ? { image: { url: p.strThumb } } : {}),
                buttons: [
                    ...(players.length > 1 ? players.slice(1).map((pl, i) => ({ id: `plr_${i}_${dateNow}`, text: `👤 ${(pl.strPlayer || "?").slice(0, 18)}` })) : []),
                    { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📢 Channel", url: conText.newsletterUrl }) },
                ],
            }, { quoted: conText.mek });

            if (players.length > 1) {
                const handleResponse = async (event) => {
                    const messageData = event.messages[0];
                    if (!messageData.message) return;
                    const bid = extractButtonId(messageData.message);
                    if (!bid || !bid.includes(dateNow.toString())) return;
                    if (messageData.key?.remoteJid !== from) return;
                    const idx = parseInt((bid.split("_")[1] || "0")) + 1;
                    const sel = players[idx];
                    if (sel) await reply(`👤 *${sel.strPlayer}*\n🏟️ ${sel.strTeam || "N/A"} | ⚽ ${sel.strPosition || "N/A"}\n🌍 ${sel.strNationality || "N/A"}`, messageData);
                    Malvin.ev.off("messages.upsert", handleResponse);
                };
                Malvin.ev.on("messages.upsert", handleResponse);
                setTimeout(() => Malvin.ev.off("messages.upsert", handleResponse), 120000);
            }
            await react("✅");
        } catch (error) {
            console.error("player error:", error.message);
            await react("❌");
            reply("Failed to search players. Please try again.");
        }
    }
);

// ==================== TEAM SEARCH ====================
mxd(
    {
        pattern: "team",
        category: "sports",
        react: "🏟️",
        aliases: ["footballteam", "soccerteam"],
        description: "Search for football teams",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react, botName, botFooter } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a team name\n\n*Example:* .team Arsenal");
        }
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/searchteams.php?t=${encodeURIComponent(q.trim())}`);
            const teams = (data?.teams || []).slice(0, 5);
            if (!teams.length) {
                await react("❌");
                return reply("No teams found.");
            }
            const t = teams[0];
            const message = `🏟️ *TEAM SEARCH*\n\n🏟️ *${t.strTeam}*\n📌 Short: ${t.strTeamShort || "N/A"}\n🏆 League: ${t.strLeague || "N/A"}\n🏟️ Stadium: ${t.strStadium || "N/A"} (${t.intStadiumCapacity || "?"} seats)\n📍 Location: ${t.strStadiumLocation || "N/A"}\n🌍 Country: ${t.strCountry || "N/A"}\n📅 Formed: ${t.intFormedYear || "N/A"}\n📝 ${(t.strDescriptionEN || "").slice(0, 300)}`;
            await sendButtons(Malvin, from, {
                title: botName, text: message, footer: `> *${botFooter}*`,
                ...(t.strTeamBadge ? { image: { url: t.strTeamBadge } } : {}),
                buttons: [{ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📢 Channel", url: conText.newsletterUrl }) }],
            }, { quoted: conText.mek });
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to search teams. Please try again.");
        }
    }
);

// ==================== VENUE ====================
mxd(
    {
        pattern: "venue",
        category: "sports",
        react: "🏟️",
        aliases: ["stadium", "ground"],
        description: "Get stadium/venue info for a team",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a team name\n\n*Example:* .venue Arsenal");
        }
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/searchteams.php?t=${encodeURIComponent(q.trim())}`);
            const t = data?.teams?.[0];
            if (!t) {
                await react("❌");
                return reply("Team not found.");
            }
            await reply(`🏟️ *${t.strStadium || t.strTeam}*\n\n🏟️ Team: ${t.strTeam}\n📍 Location: ${t.strStadiumLocation || "N/A"}\n💺 Capacity: ${t.intStadiumCapacity || "N/A"}\n📝 ${(t.strStadiumDescription || "").slice(0, 400) || "No description."}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch venue. Please try again.");
        }
    }
);

// ==================== H2H (event search, no key) ====================
mxd(
    {
        pattern: "h2h",
        category: "sports",
        react: "⚔️",
        aliases: ["headtohead", "versus"],
        description: "Head-to-head results between two teams",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        if (!q || !q.includes("|")) {
            await react("❌");
            return reply("Usage: .h2h TeamA | TeamB\n\n*Example:* .h2h Arsenal | Chelsea");
        }
        const [a, b] = q.split("|").map(s => s.trim());
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/searchevents.php?e=${encodeURIComponent(a + "_" + b)}`);
            const events = (data?.event || []).slice(0, 5);
            if (!events.length) {
                await react("❌");
                return reply("No head-to-head matches found.");
            }
            const list = events.map(e => `📅 ${e.dateEvent} — *${e.strEvent}*\n   ${e.intHomeScore ?? "?"} - ${e.intAwayScore ?? "?"} (${e.strLeague || ""})`).join("\n\n");
            await reply(`⚔️ *H2H: ${a} vs ${b}*\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch H2H. Please try again.");
        }
    }
);

// ==================== LIVESCORE ====================
mxd(
    {
        pattern: "livescore",
        category: "sports",
        react: "🔴",
        aliases: ["live", "scores"],
        description: "Live soccer scores",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/livescore.php?s=Soccer`);
            const games = (data?.events || []).slice(0, 15);
            if (!games.length) {
                await react("❌");
                return reply("No live matches right now.");
            }
            const list = games.map(g => `🔴 *${g.strEvent}*\n   ${g.intHomeScore ?? "?"} - ${g.intAwayScore ?? "?"} (${g.strProgress || "LIVE"})`).join("\n\n");
            await reply(`🔴 *LIVE SCORES*\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch livescores. Please try again.");
        }
    }
);

// ==================== HIGHLIGHTS (events with video links) ====================
mxd(
    {
        pattern: "livehighlights",
        category: "sports",
        react: "🎬",
        aliases: ["highlights", "hl"],
        description: "Recent matches with highlight videos",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/eventslastleague.php?id=4328`);
            const withVideo = (data?.events || []).filter(e => e.strVideo).slice(0, 5);
            if (!withVideo.length) {
                await react("❌");
                return reply("No highlight videos found right now.");
            }
            const list = withVideo.map(e => `🎬 *${e.strEvent}* (${e.dateEvent})\n   ${e.intHomeScore ?? "?"} - ${e.intAwayScore ?? "?"}\n   ▶️ ${e.strVideo}`).join("\n\n");
            await reply(`🎬 *HIGHLIGHTS (EPL)*\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch highlights. Please try again.");
        }
    }
);

// ==================== PER-LEAGUE: TABLE / TOPSCORERS / UPCOMING ====================
for (const [key, lg] of Object.entries(LEAGUES)) {
    // Table
    mxd(
        { pattern: `${key}table`, category: "sports", react: "📊", aliases: [`${key}standings`], description: `${lg.name} standings` },
        async (from, Malvin, conText) => {
            const { reply, react } = conText;
            try {
                await react("🔍");
                const { data } = await AX.get(`${DB}/lookuptable.php?l=${lg.id}&s=${currentSeason()}`);
                const rows = (data?.table || []).slice(0, 10);
                if (!rows.length) {
                    await react("❌");
                    return reply("Table not available right now.");
                }
                const list = rows.map(r => `${r.intRank}. *${r.strTeam}* — ${r.intPlayed}P ${r.intWin}W ${r.intDraw}D ${r.intLoss}L (${r.intPoints} pts)`).join("\n");
                await reply(`📊 *${lg.name} — TABLE*\n\n${list}`);
                await react("✅");
            } catch (error) {
                await react("❌");
                reply("Failed to fetch table. Please try again.");
            }
        }
    );
    // Top attacking teams (no free player-scorers feed exists without a key)
    mxd(
        { pattern: `${key}topscorers`, category: "sports", react: "👟", aliases: [`${key}scorers`], description: `${lg.name} top attacking teams` },
        async (from, Malvin, conText) => {
            const { reply, react } = conText;
            try {
                await react("🔍");
                const { data } = await AX.get(`${DB}/lookuptable.php?l=${lg.id}&s=${currentSeason()}`);
                const rows = [...(data?.table || [])].sort((a, b) => (parseInt(b.intGoalsFor) || 0) - (parseInt(a.intGoalsFor) || 0)).slice(0, 10);
                if (!rows.length) {
                    await react("❌");
                    return reply("Data not available right now.");
                }
                const list = rows.map((r, i) => `${i + 1}. *${r.strTeam}* — ⚽ ${r.intGoalsFor} scored in ${r.intPlayed} games`).join("\n");
                await reply(`👟 *${lg.name} — TOP ATTACK*\n_(top scoring teams; player-level scorers need a paid feed)_\n\n${list}`);
                await react("✅");
            } catch (error) {
                await react("❌");
                reply("Failed to fetch scorers. Please try again.");
            }
        }
    );
    // Upcoming fixtures
    mxd(
        { pattern: `${key}upcoming`, category: "sports", react: "📅", aliases: [`${key}fixtures`], description: `${lg.name} upcoming fixtures` },
        async (from, Malvin, conText) => {
            const { reply, react } = conText;
            try {
                await react("🔍");
                const { data } = await AX.get(`${DB}/eventsnextleague.php?id=${lg.id}`);
                const games = (data?.events || []).slice(0, 10);
                if (!games.length) {
                    await react("❌");
                    return reply("No upcoming fixtures found.");
                }
                const list = games.map(g => `📅 ${g.dateEvent} ${g.strTime || ""}\n   *${g.strEvent}* (${g.strVenue || lg.name})`).join("\n\n");
                await reply(`📅 *${lg.name} — UPCOMING*\n\n${list}`);
                await react("✅");
            } catch (error) {
                await react("❌");
                reply("Failed to fetch fixtures. Please try again.");
            }
        }
    );
}

// ==================== ODDS (fixtures + honest note) ====================
mxd(
    {
        pattern: "odds",
        category: "sports",
        react: "🎲",
        aliases: ["bettingodds", "bookies"],
        description: "Upcoming big matches (live odds need a paid feed)",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        try {
            await react("🔍");
            const { data } = await AX.get(`${DB}/eventsnextleague.php?id=4328`);
            const games = (data?.events || []).slice(0, 5);
            const list = games.length
                ? games.map(g => `📅 ${g.dateEvent}\n   *${g.strEvent}*`).join("\n\n")
                : "No fixtures found.";
            await reply(`🎲 *UPCOMING (EPL)*\n_(live bookmaker odds need a paid feed)_\n\n${list}\n\n💡 Check your bookmaker for odds.`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch data. Please try again.");
        }
    }
);

// ==================== FOOTBALL NEWS (BBC RSS, no key) ====================
mxd(
    {
        pattern: "footballnews",
        category: "sports",
        react: "📰",
        aliases: ["soccernews", "sportnews"],
        description: "Latest football news headlines",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react } = conText;
        const limit = q ? Math.min(10, parseInt(q) || 5) : 5;
        try {
            await react("📰");
            const { data: xml } = await AX.get("https://feeds.bbci.co.uk/sport/football/rss.xml");
            const $ = cheerio.load(xml, { xmlMode: true });
            const items = [];
            $("item").each((i, el) => {
                if (i >= limit) return false;
                items.push({ title: $(el).find("title").text(), link: $(el).find("link").text(), date: $(el).find("pubDate").text() });
            });
            if (!items.length) {
                await react("❌");
                return reply("Failed to fetch news.");
            }
            const list = items.map((n, i) => `${i + 1}. *${n.title}*\n   📅 ${n.date}\n   🔗 ${n.link}`).join("\n\n");
            await reply(`📰 *FOOTBALL NEWS*\n\n${list}`);
            await react("✅");
        } catch (error) {
            await react("❌");
            reply("Failed to fetch news. Please try again.");
        }
    }
);

// ==================== SPORTS HELP ====================
mxd(
    {
        pattern: "sportshelp",
        category: "sports",
        react: "⚽",
        aliases: ["sportsmenu", "sportscmds"],
        description: "Show all sports commands",
    },
    async (from, Malvin, conText) => {
        const { reply, react } = conText;
        await react("⚽");
        const leagues = Object.keys(LEAGUES).map(k => `│↠ .${k}table / .${k}upcoming / .${k}topscorers`).join("\n");
        await reply(`╭══〘〘 *SPORTS COMMANDS* 〙〙═⊷\n│↠⚽ .player <name>\n│↠🏟️ .team <name>\n│↠🏟️ .venue <team>\n│↠⚔️ .h2h <A> | <B>\n│↠🔴 .livescore\n│↠🎬 .livehighlights\n│↠🎲 .odds\n│↠📰 .footballnews [limit]\n${leagues}\n╰═════════════════⊷\n\n_No key needed (TheSportsDB + BBC)._`);
        await react("✅");
    }
);
