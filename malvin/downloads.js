// malvin/downloads.js — NO-KEY version (no MALVIN_API_KEY needed)
// Backends: play-dl direct YouTube formats, TikWM (TikTok/Douyin),
// fxtwitter (X), fdown scrape (Facebook), IG embed scrape, Pinterest
// pidgets, Spotify oEmbed + YouTube, GDrive direct, MediaFire scrape,
// Pastebin raw, Aptoide API (APK), GitHub API (gitclone).

const {
        mxd,
        gitRepoRegex,
        MAX_MEDIA_SIZE,
        getFileSize,
        getMimeCategory,
        getMimeFromUrl,
    } = require("../king"),
    axios = require("axios"),
    cheerio = require("cheerio"),
    { sendButtons } = require("malvin-btns"),
    { fancy } = require("../king/fancyFont");

const AX = axios.create({ timeout: 45000, validateStatus: () => true });

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
            try { const p = JSON.parse(nf.paramsJson); if (p.id) return p.id; } catch {}
        }
        return msg.interactiveResponseMessage.buttonId || null;
    }
    return null;
}

const isValidBuffer = (buf) => Buffer.isBuffer(buf) && buf.length > 10240;

// Free keyless fetchers (verified Oct 2026):
// - YouTube: play-dl video_info direct formats (itag 18/22). Works where
//   YouTube permits the host IP; fails gracefully elsewhere.
// - TikTok: TikWM public API (alive, no key).
// - X/Twitter: fxtwitter public API (alive, no key).
// - Facebook: fdown.net form scrape. Instagram: public embed scrape.
// - Pinterest: official pidgets widget API (no key).
async function ytDirectFormats(videoUrl) {
    const play = require("play-dl");
    const info = await play.video_info(videoUrl);
    const formats = (info?.format || []).filter(f => f.url);
    if (!formats.length) throw new Error("YouTube gave no playable stream (bot protection). Retry later or from another host.");
    return formats;
}
function withBypass(u) {
    try {
        const uu = new URL(u);
        if (!uu.searchParams.has("ratebypass")) uu.searchParams.set("ratebypass", "yes");
        return uu.toString();
    } catch { return u; }
}
function ytAudioUrl(videoUrl) {
    return ytDirectFormats(videoUrl).then(formats => {
        const audioOnly = formats.filter(f => /^audio\//.test(f.mimeType || ""));
        audioOnly.sort((a, b) => (parseInt(b.audioBitrate) || 0) - (parseInt(a.audioBitrate) || 0));
        const best = audioOnly[0] || formats.find(f => f.itag === 22) || formats.find(f => f.itag === 18) || formats[0];
        return withBypass(best.url);
    });
}
function ytVideoUrl(videoUrl) {
    return ytDirectFormats(videoUrl).then(formats => {
        const best = formats.find(f => f.itag === 22) || formats.find(f => f.itag === 18)
            || formats.find(f => (f.mimeType || "").startsWith("video/mp4")) || formats[0];
        return withBypass(best.url);
    });
}

async function tikwmFetch(pageUrl) {
    // TikWM rejects short links (vm/vt.tiktok.com) — resolve to canonical first.
    let canonical = pageUrl.trim().split(/\s+/)[0];
    if (/https?:\/\/(vm|vt)\.tiktok\.com\//i.test(canonical)) {
        try {
            const r0 = await AX.get(canonical);
            const final = (r0.request && r0.request.res && r0.request.res.responseUrl) || "";
            if (final.includes("/video/")) canonical = final;
        } catch (_) {}
    }
    const res = await AX.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(canonical)}`);
    if (res.data?.code !== 0 || !res.data?.data) throw new Error(res.data?.msg || "TikTok lookup failed.");
    const d = res.data.data;
    const video = d.play || d.wmplay;
    if (!video) throw new Error("No downloadable video found.");
    return { url: video, audio: d.music || null, title: d.title || "TikTok Video", thumb: d.cover || d.author?.avatar || null, author: d.author?.nickname || "Unknown" };
}

async function fxtwitterFetch(tweetUrl) {
    const m = tweetUrl.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
    if (!m) throw new Error("Invalid X/Twitter URL.");
    const res = await AX.get(`https://api.fxtwitter.com/i/status/${m[1]}`);
    const tw = res.data?.tweet;
    if (!tw) throw new Error("Tweet not found.");
    const media = tw.media || {};
    const videos = media.videos || [];
    const photos = media.photos || [];
    const bestVideo = videos.map(v => v.url).filter(Boolean)[0]
        || (videos[0]?.variants || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url;
    const bestPhoto = (photos[0]?.url || photos[0]) || null;
    if (!bestVideo && !bestPhoto) throw new Error("Tweet has no downloadable media (text-only?).");
    return { url: bestVideo || bestPhoto, title: (tw.text || "X post").slice(0, 120), thumb: bestPhoto, author: tw.author?.screen_name || "Unknown" };
}

async function fdownFetch(pageUrl) {
    const res = await AX.post("https://fdown.net/download.php",
        new URLSearchParams({ URL: pageUrl }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36", Referer: "https://fdown.net/" } });
    const html = typeof res.data === "string" ? res.data : "";
    const $ = cheerio.load(html);
    const links = [];
    $("a[href]").each((i, el) => {
        const href = $(el).attr("href");
        const txt = $(el).text().toLowerCase();
        if (href && /\.mp4|video|download/i.test(href + txt) && href.startsWith("http")) links.push({ href, hd: /hd|high/.test(txt) });
    });
    if (!links.length) throw new Error("No downloadable link found in this post.");
    const best = links.find(l => l.hd) || links[0];
    return { url: best.href, title: "Facebook Video", thumb: null };
}

async function igEmbedFetch(pageUrl) {
    const m = pageUrl.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    if (!m) throw new Error("Invalid Instagram URL (post/reel link required).");
    const res = await AX.get(`https://www.instagram.com/p/${m[1]}/embed/captioned/`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
    });
    const html = typeof res.data === "string" ? res.data : "";
    const vid = html.match(/<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/i)
        || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:video(?::secure_url)?"/i);
    const img = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (!vid) throw new Error("No public video found (private post or login wall).");
    return { url: vid[1].replace(/&amp;/g, "&"), title: "Instagram Video", thumb: img ? img[1] : null };
}

async function pinFetch(pinUrl) {
    const m = pinUrl.match(/pinterest\.[^/]+\/pin\/(\d+)/i);
    if (!m) throw new Error("Invalid Pinterest pin URL.");
    const res = await AX.get(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${m[1]}`);
    const pin = res.data?.data?.[0];
    if (!pin) throw new Error("Pin not found.");
    const videos = pin.videos?.video_list || {};
    const best = videos.V_720P || videos.V_480P || videos.V_360P || Object.values(videos)[0];
    const images = pin.images || {};
    const img = (images.orig || images["736x"] || {}).url || null;
    if (!best?.url && !img) throw new Error("No media found in this pin.");
    return { url: (best && best.url) || img, title: pin.description || pin.title || "Pinterest Pin", thumb: img, isImage: !best?.url };
}

// Domain dispatcher: one URL in, direct media out. Used by all thin wrappers.
// Unknown sites fall back to generic og:video scraping.
async function universalDl(pageUrl) {
    const u = pageUrl.toLowerCase();
    if (u.includes("youtube.com") || u.includes("youtu.be")) return { url: await ytVideoUrl(pageUrl), title: "YouTube Video", thumb: null };
    if (u.includes("tiktok.com") || u.includes("douyin.com") || u.includes("v.douyin.com")) return tikwmFetch(pageUrl);
    if (u.includes("twitter.com") || u.includes("x.com")) return fxtwitterFetch(pageUrl);
    if (u.includes("facebook.com") || u.includes("fb.watch")) return fdownFetch(pageUrl);
    if (u.includes("instagram.com")) return igEmbedFetch(pageUrl);
    if (u.includes("pinterest.")) return pinFetch(pageUrl);
    // Generic fallback: og:video / og:image meta tags (works for many meme/video pages).
    const res = await AX.get(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } });
    const html = typeof res.data === "string" ? res.data : "";
    const vid = html.match(/<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/i);
    const img = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const media = vid ? vid[1].replace(/&amp;/g, "&") : (img ? img[1] : null);
    if (!media) throw new Error("Unsupported site for direct download.");
    return { url: media, title: "Web Video", thumb: img ? img[1] : null };
}

// Shared button flow: pick Video or Audio, then download + send.
async function sendCobaltChoices(from, Malvin, conText, opts) {
    const { reply, react, botFooter, mxdBuffer, toAudio, formatAudio } = conText;
    const { tag, title, fileUrl, thumb, caption } = opts;
    const dateNow = Date.now();
    await sendButtons(Malvin, from, {
        title,
        text: caption ? `${caption.slice(0, 120)}\n\n*Select download type:*` : `*Select download type:*`,
        footer: botFooter,
        image: { url: thumb || "https://via.placeholder.com/400" },
        buttons: [
            { id: `${tag}_video_${dateNow}`, text: "🎬 Video" },
            { id: `${tag}_audio_${dateNow}`, text: `🎧 ${fancy("Audio only", "mono")}` },
        ],
    });

    const handleResponse = async (event) => {
        const messageData = event.messages[0];
        if (!messageData.message) return;
        const selectedButtonId = extractButtonId(messageData.message);
        if (!selectedButtonId || !selectedButtonId.includes(`_${dateNow}`)) return;
        if (messageData.key?.remoteJid !== from) return;
        await react("⬇️");
        try {
            if (selectedButtonId.startsWith(`${tag}_audio`)) {
                const videoBuffer = await mxdBuffer(fileUrl);
                if (!isValidBuffer(videoBuffer)) throw new Error("bad buffer");
                const audioBuffer = await toAudio(videoBuffer);
                if (audioBuffer.length > MAX_MEDIA_SIZE) {
                    await Malvin.sendMessage(from, { document: audioBuffer, fileName: "audio.mp3", mimetype: "audio/mpeg" }, { quoted: messageData });
                } else {
                    await Malvin.sendMessage(from, { audio: audioBuffer, mimetype: "audio/mpeg" }, { quoted: messageData });
                }
            } else {
                const fileSize = await getFileSize(fileUrl);
                if (fileSize > MAX_MEDIA_SIZE) {
                    await Malvin.sendMessage(from, { document: { url: fileUrl }, fileName: "video.mp4", mimetype: "video/mp4", caption: caption || "" }, { quoted: messageData });
                } else {
                    await Malvin.sendMessage(from, { video: { url: fileUrl }, mimetype: "video/mp4", caption: caption || "" }, { quoted: messageData });
                }
            }
            await react("✅");
        } catch (error) {
            console.error(`${tag} download error:`, error.message);
            await react("❌");
            await reply("Failed to download. Please try again.", messageData);
        }
    };
    Malvin.ev.on("messages.upsert", handleResponse);
    setTimeout(() => Malvin.ev.off("messages.upsert", handleResponse), 300000);
}

// Factory for site downloaders (same names/aliases as before).
function cobaltCommand({ pattern, aliases, emoji, site, domains, extraNote }) {
    mxd(
        { pattern, category: "downloader", react: emoji, aliases, description: `Download ${site} videos` },
        async (from, Malvin, conText) => {
            const { q, reply, react, botName } = conText;
            if (!q) {
                await react("❌");
                return reply(`Please provide a ${site} URL`);
            }
            if (domains && !domains.some(d => q.includes(d))) {
                await react("❌");
                return reply(`Please provide a valid ${site} URL`);
            }
            try {
                await react("⏳");
                const pageUrl = q.trim().split(/\s+/)[0];
                const dl = await universalDl(pageUrl);
                await sendCobaltChoices(from, Malvin, conText, {
                    tag: pattern.replace(/[^a-z0-9]/gi, ""),
                    title: `${botName} ${site.toUpperCase()} DOWNLOADER`,
                    fileUrl: dl.url, thumb: dl.thumb || null,
                    caption: extraNote || `${site} media\n📄 ${(dl.title || dl.filename || "").toString().slice(0, 100)}`,
                });
            } catch (error) {
                console.error(`${pattern} error:`, error.message);
                await react("❌");
                return reply(`An error occurred: ${error.message}`);
            }
        }
    );
}

// ==================== GITCLONE (GitHub API, no key — unchanged) ====================
mxd(
    {
        pattern: "gitclone",
        category: "downloader",
        react: "📦",
        aliases: ["gitdl", "github", "git", "repodl", "clone"],
        description: "Download GitHub repository as zip file",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, sender, botName, newsletterJid } = conText;

        if (!q) {
            await react("❌");
            return reply(`Please provide a GitHub repository link.\n\n*Usage:* .gitclone https://github.com/user/repo`);
        }
        if (!gitRepoRegex.test(q)) {
            await react("❌");
            return reply("Invalid GitHub link format. Please provide a valid GitHub repository URL.");
        }
        try {
            let [, user, repo] = q.match(gitRepoRegex) || [];
            repo = repo.replace(/\.git$/, "").split("/")[0];
            const apiUrl = `https://api.github.com/repos/${user}/${repo}`;
            const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;
            await reply(`Fetching repository *${user}/${repo}*...`);
            const repoResponse = await AX.get(apiUrl);
            if (!repoResponse.data) {
                await react("❌");
                return reply("Repository not found or access denied. Make sure the repository is public.");
            }
            const defaultBranch = repoResponse.data.default_branch || "main";
            const filename = `${user}-${repo}-${defaultBranch}.zip`;
            await Malvin.sendMessage(from,
                {
                    document: { url: zipUrl },
                    fileName: filename,
                    mimetype: "application/zip",
                    contextInfo: {
                        forwardingScore: 1, isForwarded: true,
                        forwardedNewsletterMessageInfo: { newsletterJid, newsletterName: botName, serverMessageId: 143 },
                    },
                },
                { quoted: mek });
            await react("✅");
        } catch (error) {
            console.error("GitClone error:", error.message);
            await react("❌");
            if (error.message?.includes("404")) return reply("Repository not found.");
            return reply(`Failed to download repository: ${error.message}`);
        }
    }
);

// ==================== COBALT-BACKED DOWNLOADERS ====================
cobaltCommand({ pattern: "fb", aliases: ["fbdl", "facebookdl", "facebook"], emoji: "📘", site: "Facebook", domains: ["facebook.com", "fb.watch"] });
cobaltCommand({ pattern: "tiktok", aliases: ["tiktokdl", "ttdl", "tt"], emoji: "🎵", site: "TikTok", domains: ["tiktok.com"] });
cobaltCommand({ pattern: "tiktokv2", aliases: ["ttv2"], emoji: "🎵", site: "TikTok", domains: ["tiktok.com"] });
cobaltCommand({ pattern: "tiktok2", aliases: ["tt2"], emoji: "🎵", site: "TikTok", domains: ["tiktok.com"] });
cobaltCommand({ pattern: "tiktok5", aliases: ["tt5"], emoji: "🎵", site: "TikTok", domains: ["tiktok.com"] });
cobaltCommand({ pattern: "tiktok7", aliases: ["tt7"], emoji: "🎵", site: "TikTok", domains: ["tiktok.com"] });
cobaltCommand({ pattern: "ig", aliases: ["insta", "instadl", "igdl", "instagram"], emoji: "📸", site: "Instagram", domains: ["instagram.com"] });
cobaltCommand({ pattern: "yt", aliases: ["ytdl", "youtube", "ytmp4", "ytmp3"], emoji: "▶️", site: "YouTube", domains: ["youtube.com", "youtu.be"] });
cobaltCommand({ pattern: "twitter2", aliases: ["xdl", "xdownloader", "x"], emoji: "🐦", site: "Twitter/X", domains: ["twitter.com", "x.com"] });
cobaltCommand({ pattern: "threads", aliases: ["threadsdl"], emoji: "🧵", site: "Threads", domains: ["threads.com", "threads.net"] });
cobaltCommand({ pattern: "pinterest", aliases: ["pin", "pinterestdl"], emoji: "📌", site: "Pinterest", domains: ["pinterest."] });
cobaltCommand({ pattern: "savefrom", aliases: ["savefromdl", "sf"], emoji: "💾", site: "video", domains: null });
cobaltCommand({ pattern: "fastdl", aliases: ["fastdownload"], emoji: "⚡", site: "video", domains: null });
cobaltCommand({ pattern: "ummy", aliases: ["ummydl"], emoji: "📥", site: "video", domains: null });
cobaltCommand({ pattern: "vidsplay", aliases: ["vidsplaydl"], emoji: "🎬", site: "video", domains: null });
cobaltCommand({ pattern: "capcut", aliases: ["capcutdl", "ccdl"], emoji: "✂️", site: "CapCut", domains: ["capcut.com"] });
cobaltCommand({ pattern: "snackvideo2", aliases: ["snack2"], emoji: "🍿", site: "SnackVideo", domains: ["snackvideo.", "sck.io"] });
cobaltCommand({ pattern: "douyin", aliases: ["douyindl", "dy"], emoji: "🎶", site: "Douyin", domains: ["douyin.com", "v.douyin.com"] });
cobaltCommand({ pattern: "snack", aliases: ["snackdl", "snackvideo"], emoji: "🍿", site: "SnackVideo", domains: ["snackvideo.", "sck.io"] });
cobaltCommand({ pattern: "lahelu", aliases: ["laheludl"], emoji: "😂", site: "Lahelu", domains: ["lahelu.com"] });

// ==================== SPOTIFY (oEmbed + YouTube fallback, no key) ====================
mxd(
    {
        pattern: "spotify",
        category: "downloader",
        react: "🎧",
        aliases: ["spotifydl", "spotidl", "spoti"],
        description: "Download Spotify tracks by URL or song name",
    },
    async (from, Malvin, conText) => {
        const { q, reply, react, botName, botFooter, mxdBuffer, formatAudio } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a Spotify URL or song name\n\n*Examples:*\n.spotify https://open.spotify.com/track/...\n.spotify The Spectre Alan Walker");
        }
        try {
            await react("🔍");
            let searchTerm = q.trim();
            if (q.includes("spotify.com")) {
                // Free oEmbed resolves the track title without any key.
                try {
                    const { data } = await AX.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(q.trim().split(/\s+/)[0])}`);
                    if (data?.title) searchTerm = data.title;
                } catch (_) {}
            }
            const yts = require("yt-search");
            const r = await yts(searchTerm);
            const v = r?.videos?.[0];
            if (!v?.url) {
                await react("❌");
                return reply("No tracks found. Try a different song name.");
            }
            const { url: fileUrl } = { url: await ytAudioUrl(v.url) };
            const audioBuffer = await mxdBuffer(fileUrl);
            if (!isValidBuffer(audioBuffer)) {
                await react("❌");
                return reply("Failed to download audio.");
            }
            const formattedAudio = await formatAudio(audioBuffer);
            await Malvin.sendMessage(from, {
                audio: formattedAudio, mimetype: "audio/mpeg",
            }, { quoted: conText.mek });
            await Malvin.sendMessage(from, { text: `🎧 *${v.title}*\n⏱️ ${v.timestamp}\n\n> *${botFooter}*` }, { quoted: conText.mek });
            await react("✅");
        } catch (error) {
            console.error("Spotify error:", error.message);
            await react("❌");
            return reply(`An error occurred: ${error.message}`);
        }
    }
);

// ==================== GOOGLE DRIVE (direct link, no key) ====================
mxd(
    {
        pattern: "gdrive",
        category: "downloader",
        react: "📁",
        aliases: ["googledrive", "drive", "gdrivedl"],
        description: "Download from Google Drive",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, mxdBuffer, formatAudio, formatVideo } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a Google Drive URL");
        }
        if (!q.includes("drive.google.com")) {
            await react("❌");
            return reply("Please provide a valid Google Drive URL");
        }
        try {
            await react("⬇️");
            const m = q.match(/[-\w]{25,}/);
            if (!m) {
                await react("❌");
                return reply("Could not extract a file ID from that URL.");
            }
            const downloadUrl = `https://drive.google.com/uc?export=download&id=${m[0]}`;
            const fileBuffer = await mxdBuffer(downloadUrl);
            if (!isValidBuffer(fileBuffer)) {
                await react("❌");
                return reply("Failed to download file. Make sure the file is publicly accessible (Anyone with the link).");
            }
            const mimetype = getMimeFromUrl(downloadUrl);
            const mimeCategory = getMimeCategory(mimetype);
            if (mimeCategory === "audio") {
                await Malvin.sendMessage(from, { audio: await formatAudio(fileBuffer), mimetype: "audio/mpeg" }, { quoted: mek });
            } else if (mimeCategory === "video") {
                await Malvin.sendMessage(from, { video: await formatVideo(fileBuffer), caption: "📁 *Google Drive*" }, { quoted: mek });
            } else if (mimeCategory === "image") {
                await Malvin.sendMessage(from, { image: fileBuffer, caption: "📁 *Google Drive*" }, { quoted: mek });
            } else {
                await Malvin.sendMessage(from, { document: fileBuffer, fileName: "gdrive_file", mimetype: mimetype || "application/octet-stream" }, { quoted: mek });
            }
            await react("✅");
        } catch (error) {
            console.error("GDrive error:", error.message);
            await react("❌");
            return reply(`An error occurred: ${error.message}`);
        }
    }
);

// ==================== MEDIAFIRE (page scrape, no key) ====================
mxd(
    {
        pattern: "mediafire",
        category: "downloader",
        react: "📁",
        aliases: ["mediafiredl", "mf", "mfdl"],
        description: "Download from MediaFire",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, mxdBuffer } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a MediaFire URL");
        }
        if (!q.includes("mediafire.com")) {
            await react("❌");
            return reply("Please provide a valid MediaFire URL");
        }
        try {
            await react("⬇️");
            const pageUrl = q.trim().split(/\s+/)[0];
            const { data: html } = await AX.get(pageUrl);
            const $ = cheerio.load(html);
            const direct = $("#downloadButton").attr("href");
            const fileName = $(".filename").first().text().trim() || "mediafire_file";
            if (!direct) {
                await react("❌");
                return reply("Could not find a download link on that page.");
            }
            const fileBuffer = await mxdBuffer(direct);
            if (!isValidBuffer(fileBuffer)) {
                await react("❌");
                return reply("Failed to download file.");
            }
            const mimetype = getMimeFromUrl(fileName);
            await Malvin.sendMessage(from, { document: fileBuffer, fileName, mimetype: mimetype || "application/octet-stream", caption: `📁 *MediaFire*\n📄 ${fileName}` }, { quoted: mek });
            await react("✅");
        } catch (error) {
            console.error("MediaFire error:", error.message);
            await react("❌");
            return reply(`An error occurred: ${error.message}`);
        }
    }
);

// ==================== PASTEBIN (raw, no key) ====================
mxd(
    {
        pattern: "pastebin",
        category: "downloader",
        react: "📋",
        aliases: ["pastebindl", "paste"],
        description: "Fetch a Pastebin paste as text",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide a Pastebin URL or ID\n\n*Example:* .pastebin https://pastebin.com/abc123");
        }
        try {
            await react("🔍");
            const id = (q.match(/pastebin\.com\/([A-Za-z0-9]+)/)?.[1] || q.trim().split(/\s+/)[0]).replace(/[^A-Za-z0-9]/g, "");
            const { data } = await AX.get(`https://pastebin.com/raw/${id}`);
            const text = typeof data === "string" ? data : JSON.stringify(data);
            if (!text || /has been removed|not found/i.test(text.slice(0, 200))) {
                await react("❌");
                return reply("Paste not found or removed.");
            }
            if (text.length > 60000) {
                await Malvin.sendMessage(from, { document: Buffer.from(text), fileName: `${id}.txt`, mimetype: "text/plain" }, { quoted: mek });
            } else {
                await reply(`📋 *Pastebin ${id}*\n\n${text.slice(0, 3500)}`);
            }
            await react("✅");
        } catch (error) {
            await react("❌");
            return reply(`An error occurred: ${error.message}`);
        }
    }
);

// ==================== APK (Aptoide API, no key) ====================
mxd(
    {
        pattern: "apk",
        category: "downloader",
        react: "📱",
        aliases: ["apkdl", "appdl", "playstore"],
        description: "Download Android APKs by app name",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, botFooter } = conText;
        if (!q) {
            await react("❌");
            return reply("Please provide an app name\n\n*Example:* .apk whatsapp");
        }
        try {
            await react("🔍");
            const { data } = await AX.get(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(q.trim())}&limit=5`);
            const apps = data?.datalist?.list || [];
            if (!apps.length) {
                await react("❌");
                return reply("No apps found. Try a different name.");
            }
            const app = apps[0];
            const apkUrl = app?.file?.path;
            const message = `📱 *${app.name}*\n📦 ${app.package}\n⭐ ${app.stats?.rating?.avg || "N/A"} | 📥 ${app.stats?.downloads || "N/A"} downloads\n💾 ${app.size ? (app.size / 1048576).toFixed(1) + " MB" : "Unknown size"}`;
            if (!apkUrl) {
                await react("❌");
                return reply(message + "\n\n❌ No direct APK link available.");
            }
            await Malvin.sendMessage(from, { image: { url: app.icon }, caption: message + `\n\n⬇️ Downloading APK...` } , { quoted: mek });
            const size = await getFileSize(apkUrl);
            if (size > MAX_MEDIA_SIZE) {
                await reply(`📱 *${app.name}*\n🔗 Direct link (${(size / 1048576).toFixed(1)} MB, too large for WhatsApp):\n${apkUrl}`);
            } else {
                await Malvin.sendMessage(from, { document: { url: apkUrl }, fileName: `${app.package}.apk`, mimetype: "application/vnd.android.package-archive", caption: message }, { quoted: mek });
            }
            await react("✅");
        } catch (error) {
            console.error("APK error:", error.message);
            await react("❌");
            return reply(`An error occurred: ${error.message}`);
        }
    }
);

// ==================== MEGA / TERABOX / ALAMY (no free direct API) ====================
// These hosts need authenticated/encrypted sessions. The commands stay alive,
// explain the limit, and hand back a direct open link instead of failing silently.
for (const [pattern, aliases, emoji, host, linkHint] of [
    ["mega", ["megadl", "meganz"], "☁️", "MEGA", "Open the link in the MEGA app to download (encrypted links need a session)."],
    ["terabox", ["teraboxdl", "tb"], "📦", "Terabox", "Terabox needs a logged-in session/cookies — open the link in a browser."],
    ["alamy", ["alamydl", "stock"], "🖼️", "Alamy", "Alamy is a paid stock library — open the link to preview/purchase."],
]) {
    mxd(
        { pattern, category: "downloader", react: emoji, aliases, description: `Download from ${host} (assisted)` },
        async (from, Malvin, conText) => {
            const { q, reply, react } = conText;
            if (!q) {
                await react("❌");
                return reply(`Please provide a ${host} URL`);
            }
            await react("ℹ️");
            const url = q.trim().split(/\s+/)[0];
            await reply(`☁️ *${host}*\n\n${linkHint}\n\n🔗 ${url}\n\n_Direct bots cannot bypass ${host} encryption/login without an API key._`);
            await react("✅");
        }
    );
}
