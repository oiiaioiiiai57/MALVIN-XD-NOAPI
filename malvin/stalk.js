const { mxd } = require("../king");
const { mrxd } = require('../king/mrxd');
const axios = require("axios");
const { sendButtons } = require("malvin-btns");
const { fancy } = require("../king/fancyFont");

const AX = axios.create({ timeout: 15000 });

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

// Free metadata resolver (no key): Microlink returns title/description/image
// for most public profile pages. Follower counts need a login, so stalk
// cards show what is publicly reachable + a direct profile link.
async function microlinkMeta(pageUrl) {
    const { data } = await AX.get(`https://api.microlink.io?url=${encodeURIComponent(pageUrl)}`);
    const d = data?.data;
    if (!d) throw new Error("no metadata");
    return {
        title: d.title || null,
        description: d.description || null,
        image: d.image?.url || d.logo?.url || null,
        url: d.url || pageUrl,
    };
}

// ==================== GITHUB STALK (api.github.com, no key) ====================
mxd(
    {
        pattern: "github",
        category: "stalk",
        react: "🐙",
        aliases: ["ghstalk", "gitstalk", "gh"],
        description: "Get GitHub user profile information",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react, botName, botFooter } = conText;

        if (!q) {
            await react("❌");
            return reply("Please provide a GitHub username\n\n*Example:* .github octocat");
        }

        try {
            await react("🔍");
            const username = q.trim().split(/\s+/)[0];
            const [{ data: u }, { data: reposAll }] = await Promise.all([
                AX.get(`https://api.github.com/users/${encodeURIComponent(username)}`),
                AX.get(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=stars`),
            ]).catch(() => [{ data: null }, { data: null }]);

            if (!u?.login) {
                await react("❌");
                return reply("GitHub user not found.");
            }

            const reposNorm = (Array.isArray(reposAll) ? reposAll : []).map(r => ({
                name: r.name, stars: r.stargazers_count, forks: r.forks_count,
                language: r.language, url: r.html_url,
            }));
            const totalStars = reposNorm.reduce((s, r) => s + (r.stars || 0), 0);
            const topLangs = [...new Set(reposNorm.map(r => r.language).filter(Boolean))].slice(0, 5);
            const dateNow = Date.now();

            const message = `╭══〘〘 *GITHUB STALK* 〙〙═⊷
│↠🐙 ${fancy("username", "smallcaps")}: ${u.login}
│↠📛 ${fancy("name", "smallcaps")}: ${u.name || "N/A"}
│↠📝 ${fancy("bio", "smallcaps")}: ${u.bio || "No bio"}
│↠🏢 ${fancy("company", "smallcaps")}: ${u.company || "N/A"}
│↠📍 ${fancy("location", "smallcaps")}: ${u.location || "N/A"}
│↠📅 ${fancy("joined", "smallcaps")}: ${new Date(u.created_at).toLocaleDateString()}
╰═════════════════⊷

📊 *${fancy("statistics", "smallcaps")}*
│↠👥 ${fancy("followers", "smallcaps")}: ${u.followers}
│↠👤 ${fancy("following", "smallcaps")}: ${u.following}
│↠📁 ${fancy("repos", "smallcaps")}: ${u.public_repos}
│↠⭐ ${fancy("total stars", "smallcaps")}: ${totalStars}
│↠💻 ${fancy("top languages", "smallcaps")}: ${topLangs.join(", ") || "N/A"}
╰═════════════════⊷

📂 *${fancy("top repositories", "smallcaps")}*
${reposNorm.slice(0, 3).map((repo, i) => `${i + 1}. ${repo.name}\n   ⭐ ${repo.stars} | 🍴 ${repo.forks} | 💻 ${repo.language || "N/A"}`).join("\n\n")}
`;

            await sendButtons(Malvin, from, {
                title: botName,
                text: message,
                footer: `> *${botFooter}*`,
                image: { url: u.avatar_url },
                buttons: [
                    { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 View Profile", url: u.html_url }) },
                    { id: `gh_repos_${dateNow}`, text: "📁 View All Repos" },
                    { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "📋 Copy Username", copy_code: u.login }) },
                ],
            }, { quoted: mrxd });

            const handleResponse = async (event) => {
                const messageData = event.messages[0];
                if (!messageData.message) return;
                const selectedButtonId = extractButtonId(messageData.message);
                if (!selectedButtonId || !selectedButtonId.includes(dateNow.toString())) return;
                if (messageData.key?.remoteJid !== from) return;
                if (selectedButtonId.startsWith("gh_repos")) {
                    await react("📁");
                    const repoList = reposNorm.slice(0, 10).map((repo, i) =>
                        `${i + 1}. *${repo.name}*\n   ⭐ ${repo.stars} | 🍴 ${repo.forks} | 💻 ${repo.language || "N/A"}\n   🔗 ${repo.url}`
                    ).join("\n\n");
                    await reply(`📁 *${u.login}'s REPOSITORIES*\n\n${repoList}`, messageData);
                }
                Malvin.ev.off("messages.upsert", handleResponse);
            };

            Malvin.ev.on("messages.upsert", handleResponse);
            setTimeout(() => Malvin.ev.off("messages.upsert", handleResponse), 300000);
            await react("✅");

        } catch (error) {
            console.error("GitHub stalk error:", error.message);
            await react("❌");
            reply("Failed to fetch GitHub profile. Please check the username.");
        }
    }
);

// Generic public-profile card (Microlink, no key).
async function sendPublicProfileCard(from, Malvin, conText, { label, emoji, username, pageUrl, usage }) {
    const { reply, react, botName, botFooter } = conText;
    if (!username) {
        await react("❌");
        return reply(usage);
    }
    try {
        await react("🔍");
        const meta = await microlinkMeta(pageUrl);
        const message = `╭══〘〘 *${label}* 〙〙═⊷
│↠${emoji} ${fancy("user", "smallcaps")}: @${username}
│↠📛 ${fancy("title", "smallcaps")}: ${meta.title || "N/A"}
│↠📝 ${fancy("bio", "smallcaps")}: ${(meta.description || "No public bio").slice(0, 200)}
╰═════════════════⊷

⚠️ *${fancy("note", "smallcaps")}*: ${fancy("follower counts need a login, showing public info only", "smallcaps")}.`;

        const buttons = [
            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 View Profile", url: meta.url }) },
            { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "📋 Copy Username", copy_code: username }) },
        ];
        const msgOpts = { title: botName, text: message, footer: `> *${botFooter}*`, buttons };
        if (meta.image) msgOpts.image = { url: meta.image };
        await sendButtons(Malvin, from, msgOpts, { quoted: mrxd });
        await react("✅");
    } catch (error) {
        console.error(`${label} error:`, error.message);
        await react("❌");
        reply(`Failed to fetch profile. The account may be private or the username wrong.\n🔗 ${pageUrl}`);
    }
}

// ==================== INSTAGRAM STALK (Microlink, no key) ====================
mxd(
    {
        pattern: "igstalk",
        category: "stalk",
        react: "📸",
        aliases: ["instagram", "instastalk", "ig"],
        description: "Get Instagram user profile information",
    },
    async (from, Malvin, conText) => {
        const username = (conText.q || "").replace(/^@/, "").trim().split(/\s+/)[0];
        await sendPublicProfileCard(from, Malvin, conText, {
            label: "INSTAGRAM STALK", emoji: "📸", username,
            pageUrl: `https://www.instagram.com/${encodeURIComponent(username || "")}/`,
            usage: "Please provide an Instagram username\n\n*Example:* .igstalk cristiano",
        });
    }
);

// ==================== TIKTOK STALK (oEmbed + Microlink, no key) ====================
mxd(
    {
        pattern: "ttstalk",
        category: "stalk",
        react: "📱",
        aliases: ["tiktokstalk", "tt"],
        description: "Get TikTok user profile information",
    },
    async (from, Malvin, conText) => {
        const { reply, react, botName, botFooter } = conText;
        const username = (conText.q || "").replace(/^@/, "").trim().split(/\s+/)[0];
        if (!username) {
            await react("❌");
            return reply("Please provide a TikTok username\n\n*Example:* .ttstalk malvintech");
        }
        try {
            await react("🔍");
            let title = null, thumb = null;
            try {
                const { data } = await AX.get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${username}`)}`);
                title = data?.author_name || null; thumb = data?.thumbnail_url || null;
            } catch (_) {}
            const pageUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
            const meta = await microlinkMeta(pageUrl).catch(() => null);
            const message = `╭══〘〘 *TIKTOK STALK* 〙〙═⊷
│↠📱 ${fancy("user", "smallcaps")}: @${username}
│↠📛 ${fancy("author", "smallcaps")}: ${title || meta?.title || "N/A"}
│↠📝 ${fancy("bio", "smallcaps")}: ${((meta?.description) || "No public bio").slice(0, 200)}
╰═════════════════⊷

⚠️ *${fancy("note", "smallcaps")}*: ${fancy("follower counts need a login, showing public info only", "smallcaps")}.`;
            const msgOpts = { title: botName, text: message, footer: `> *${botFooter}*`, buttons: [
                { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 View Profile", url: pageUrl }) },
                { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "📋 Copy Username", copy_code: username }) },
            ]};
            if (thumb || meta?.image) msgOpts.image = { url: thumb || meta.image };
            await sendButtons(Malvin, from, msgOpts, { quoted: mrxd });
            await react("✅");
        } catch (error) {
            console.error("TikTok stalk error:", error.message);
            await react("❌");
            reply("Failed to fetch TikTok profile. Please check the username.");
        }
    }
);

// ==================== TWITTER/X STALK (Microlink, no key) ====================
mxd(
    {
        pattern: "twitterstalk",
        category: "stalk",
        react: "🐦",
        aliases: ["xstalk", "twstalk", "twitter"],
        description: "Get Twitter/X profile information",
    },
    async (from, Malvin, conText) => {
        const username = (conText.q || "").replace(/^@/, "").trim().split(/\s+/)[0];
        await sendPublicProfileCard(from, Malvin, conText, {
            label: "TWITTER STALK", emoji: "🐦", username,
            pageUrl: `https://x.com/${encodeURIComponent(username || "")}`,
            usage: "Please provide a Twitter/X username\n\n*Example:* .twitterstalk elonmusk",
        });
    }
);

// ==================== YOUTUBE STALK (yt-search, no key) ====================
mxd(
    {
        pattern: "ytstalk",
        category: "stalk",
        react: "📺",
        aliases: ["youtubestalk", "youtube", "yt"],
        description: "Get YouTube channel information",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react, botName, botFooter } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a YouTube username or channel handle\n\n*Example:* .ytstalk @MrBeast");
        }
        const handle = q.trim().split(/\s+/)[0];
        try {
            await react("🔍");
            const yts = require("yt-search");
            const r = await yts(handle);
            const videos = (r?.videos || []).slice(0, 10);
            if (!videos.length) {
                await react("❌");
                return reply("YouTube channel not found.");
            }
            const author = videos[0].author || {};
            const dateNow = Date.now();
            const message = `╭══〘〘 *YOUTUBE STALK* 〙〙═⊷
│↠📺 ${fancy("channel", "smallcaps")}: ${author.name || handle}
│↠🔗 ${fancy("url", "smallcaps")}: ${author.url || "N/A"}
╰═════════════════⊷

🎥 *${fancy("latest videos", "smallcaps")}*
${videos.slice(0, 3).map((v, i) => `${i + 1}. ${v.title}\n   👁️ ${v.views?.toLocaleString?.() ?? v.views} views | ⏱️ ${v.timestamp} | 📅 ${v.ago}`).join("\n\n")}
`;
            await sendButtons(Malvin, from, {
                title: botName, text: message, footer: `> *${botFooter}*`,
                image: videos[0].thumbnail ? { url: videos[0].thumbnail } : undefined,
                buttons: [
                    ...(author.url ? [{ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 View Channel", url: author.url }) }] : []),
                    { id: `yt_videos_${dateNow}`, text: "🎬 More Videos" },
                    { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "📋 Copy Handle", copy_code: handle }) },
                ],
            }, { quoted: mrxd });

            const handleResponse = async (event) => {
                const messageData = event.messages[0];
                if (!messageData.message) return;
                const selectedButtonId = extractButtonId(messageData.message);
                if (!selectedButtonId || !selectedButtonId.includes(dateNow.toString())) return;
                if (messageData.key?.remoteJid !== from) return;
                if (selectedButtonId.startsWith("yt_videos")) {
                    await react("🎬");
                    await reply(`🎬 *${author.name || handle}'s LATEST VIDEOS*\n\n${videos.map((v, i) => `${i + 1}. *${v.title}*\n   👁️ ${v.views?.toLocaleString?.() ?? v.views} views | ⏱️ ${v.timestamp}\n   🔗 ${v.url}`).join("\n\n")}`, messageData);
                }
                Malvin.ev.off("messages.upsert", handleResponse);
            };
            Malvin.ev.on("messages.upsert", handleResponse);
            setTimeout(() => Malvin.ev.off("messages.upsert", handleResponse), 300000);
            await react("✅");
        } catch (error) {
            console.error("YouTube stalk error:", error.message);
            await react("❌");
            reply("Failed to fetch YouTube channel. Please check the handle.");
        }
    }
);

// ==================== PINTEREST STALK (Microlink, no key) ====================
mxd(
    {
        pattern: "pinstalk",
        category: "stalk",
        react: "📌",
        aliases: ["pintereststalk", "pinterest", "pin"],
        description: "Get Pinterest user profile information",
    },
    async (from, Malvin, conText) => {
        const username = (conText.q || "").replace(/^@/, "").trim().split(/\s+/)[0];
        await sendPublicProfileCard(from, Malvin, conText, {
            label: "PINTEREST STALK", emoji: "📌", username,
            pageUrl: `https://www.pinterest.com/${encodeURIComponent(username || "")}/`,
            usage: "Please provide a Pinterest username\n\n*Example:* .pinstalk example",
        });
    }
);

// ==================== STALK HELP COMMAND ====================
mxd(
    {
        pattern: "stalkhelp",
        category: "stalk",
        react: "🔍",
        aliases: ["stalkcmds", "stalkcommands"],
        description: "Show all stalk commands",
    },
    async (from, Malvin, conText) => {
        const { reply, react, botFooter, botName } = conText;

        await react("🔍");

        const message = `╭══〘〘 *STALK COMMANDS* 〙〙═⊷
│↠🐙 .github <username> - GitHub profile
│↠📸 .igstalk <username> - Instagram profile
│↠📱 .ttstalk <username> - TikTok profile
│↠🐦 .twitterstalk <username> - Twitter/X profile
│↠📺 .ytstalk <handle> - YouTube channel
│↠📌 .pinstalk <username> - Pinterest profile
╰═════════════════⊷

📝 *${fancy("examples", "smallcaps")}*
│↠ .github MalvinTechInfo
│↠ .igstalk cristiano
│↠ .ttstalk malvintech
│↠ .twitterstalk elonmusk
│↠ .ytstalk @malvintech
│↠ .pinstalk example
╰═════════════════⊷

⚠️ ${fancy("no key needed - public info only", "smallcaps")}.
`;

        await sendButtons(Malvin, from, {
            title: botName,
            text: message,
            footer: `> *${botFooter}*`,
            buttons: [
                {
                    name: "cta_copy",
                    buttonParamsJson: JSON.stringify({
                        display_text: "📋 Copy Help",
                        copy_code: message,
                    }),
                },
            ],
        }, { quoted: mrxd });

        await react("✅");
    }
);
