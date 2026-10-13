const { mxd } = require("../king");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

const {
    downloadContentFromMessage,
    generateWAMessageFromContent,
    normalizeMessageContent,
} = require("mrxd-baileys");
const { sendButtons } = require("malvin-btns");

const isValidBuffer = (buf) => Buffer.isBuffer(buf) && buf.length > 10240;
const YT_URL_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/i;

function progressBar(pct) {
    const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
    return "█".repeat(filled) + "░".repeat(10 - filled);
}

// Live % progress message: edited in place when supported, otherwise
// replaced (old copy deleted, best effort). Throttled to avoid spam.
async function sendProgress(Malvin, chat, label) {
    let key = null;
    try {
        const sent = await Malvin.sendMessage(chat, { text: `${label}\n0% ${progressBar(0)}` });
        key = sent?.key || null;
    } catch (_) {}
    let last = -1;
    let lastTime = 0;
    const render = (pct) => `${label}\n${pct}% ${progressBar(pct)}`;
    const swap = async (text) => {
        const nm = await Malvin.sendMessage(chat, { text });
        if (key) await Malvin.sendMessage(chat, { delete: key }).catch(() => {});
        key = nm?.key || null;
    };
    const update = async (pct) => {
        pct = Math.max(0, Math.min(100, Math.floor(pct)));
        const now = Date.now();
        if (pct <= last || (pct < 100 && (pct - last < 5 || now - lastTime < 2000))) return;
        last = pct; lastTime = now;
        try {
            if (!key) throw new Error("no-key");
            await Malvin.sendMessage(chat, { text: render(pct), edit: key });
        } catch (_) {
            try { await swap(render(pct)); last = pct; lastTime = now; } catch (_) {}
        }
    };
    const setText = async (text) => {
        try {
            if (!key) throw new Error("no-key");
            await Malvin.sendMessage(chat, { text, edit: key });
        } catch (_) {
            try { await swap(text); } catch (_) {}
        }
    };
    return { update, setText };
}

// Streamed GET with byte progress (caller chooses buffer vs file).
async function dlStream(url, onData, extraHeaders = {}) {
    const res = await axios.get(url, {
        responseType: "stream",
        timeout: 600000,
        maxRedirects: 5,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36", ...extraHeaders },
        validateStatus: (s) => s >= 200 && s < 300,
    });
    const total = parseInt(res.headers["content-length"] || "0", 10) || 0;
    let received = 0;
    await new Promise((resolve, reject) => {
        res.data.on("data", (c) => { received += c.length; onData(c, received, total); });
        res.data.on("end", () => resolve());
        res.data.on("error", reject);
    });
    return { total, received };
}

// Safely turn any thrown value into a short, readable string for WhatsApp.
function describeError(error) {
    if (!error) return "Unknown error (nothing was thrown)";
    if (error.response?.data) {
        const d = error.response.data;
        return d?.error || d?.message || `HTTP ${error.response.status}`;
    }
    if (typeof error.message === "string" && error.message.length) return error.message;
    if (typeof error === "string") return error;
    try {
        const s = JSON.stringify(error);
        if (s && s !== "{}") return s.slice(0, 300);
    } catch {}
    return String(error);
}

// Direct media download with a long timeout (the core mxdBuffer times out
// at 30s, too short for big video files on slow links).
async function dlMedia(url, ms = 300000) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: ms,
        maxRedirects: 5,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
        validateStatus: (s) => s >= 200 && s < 300,
    });
    return Buffer.from(res.data);
}

// Pre-download the thumbnail ourselves (long timeout) so the button lib
// doesn't fetch the URL with its own short timeout. Falls back to botPic URL.
async function fetchThumb(thumbnail, botPic) {
    if (thumbnail) {
        try {
            const tb = await dlMedia(thumbnail, 60000);
            if (Buffer.isBuffer(tb) && tb.length > 1024) return tb;
        } catch (_) {}
    }
    return { url: botPic };
}

// ==================== CLUTCH (search + download, single source) ====================
// GET /download/clutchplay?query= — searches by name, returns a ready MP3
// link plus metadata in one call.
async function fetchFromClutchPlay(query, conText) {
    const { MalvinTechApi, MalvinApiKey } = conText;
    // The endpoint is flaky (occasional HTTP 500) — retry once before giving up.
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await axios.get(`${MalvinTechApi}/download/clutchplay`, {
            params: { apikey: MalvinApiKey, query },
            timeout: 120000,
            validateStatus: () => true,
        });
        if (res.status < 400 && res.data?.status !== false && res.data?.data) return res.data.data;
        lastErr = new Error(res.data?.error || res.data?.message || `Search failed (HTTP ${res.status})`);
        await new Promise(r => setTimeout(r, 2000));
    }
    throw lastErr;
}

// youtube2 resolver (clutchyt currently returns HTTP 500 server-side).
// Shape: { title, thumbnail, audio, videos: {144..1080} }.
async function fetchYoutube2(videoUrl, conText) {
    const { MalvinTechApi, MalvinApiKey } = conText;
    const res = await axios.get(`${MalvinTechApi}/download/youtube2`, {
        params: { apikey: MalvinApiKey, url: videoUrl },
        timeout: 180000,
        validateStatus: () => true,
    });
    if (res.status >= 400 || res.data?.status === false) {
        const apiMessage = res.data?.error || res.data?.message;
        throw new Error(apiMessage || `Video fetch failed (HTTP ${res.status})`);
    }
    const d = res.data?.data || {};
    const videos = d.videos || {};
    const video = videos["720"] || videos["480"] || videos["360"] || videos["1080"] || Object.values(videos)[0];
    if (!video) throw new Error("No downloadable video format found.");
    return { title: d.title, duration: d.duration || "N/A", thumbnail: d.thumbnail, video_id: Date.now().toString(), url: videoUrl, video };
}

// GET /download/clutchyt?url=&quality= — resolves a specific YouTube URL at
// a specific quality.
async function fetchFromClutchYoutube(videoUrl, conText, quality = "720") {
    const { MalvinTechApi, MalvinApiKey } = conText;
    const res = await axios.get(`${MalvinTechApi}/download/clutchyt`, {
        params: { apikey: MalvinApiKey, url: videoUrl, quality },
        timeout: 180000,
        validateStatus: () => true,
    });
    if (res.status >= 400 || res.data?.status === false) {
        const apiMessage = res.data?.error || res.data?.message;
        throw new Error(apiMessage || `Video fetch failed (HTTP ${res.status})`);
    }
    return res.data?.data;
}

// ==================== SENDAUDIO ====================
mxd(
  {
    pattern: "sendaudio",
    aliases: ["sendmp3", "dlmp3", "dlaudio"],
    category: "downloader",
    react: "🎶",
    description: "Download Audio from url",
  },
  async (from, Malvin, conText) => {
    const { q, mek, reply, react, botFooter, mxdBuffer, formatAudio } = conText;

    if (!q) {
      await react("❌");
      return reply("Please provide audio url");
    }

    try {
      const buffer = await mxdBuffer(q);
      const convertedBuffer = await formatAudio(buffer);
      if (buffer instanceof Error) {
        await react("❌");
        return reply("Failed to download the audio file.");
      }
      await Malvin.sendMessage(from, {
        audio: convertedBuffer,
        mimetype: "audio/mpeg",
        caption: `> *${botFooter}*`,
      }, { quoted: mek });
      await react("✅");
    } catch (error) {
      console.error("Error:", error);
      await react("❌");
      return reply("Oops! Something went wrong. Please try again.");
    }
  },
);

// ==================== SENDVIDEO ====================
mxd(
  {
    pattern: "sendvideo",
    aliases: ["sendmp4", "dlmp4", "dvideo"],
    category: "downloader",
    react: "🎥",
    description: "Download Video from url",
  },
  async (from, Malvin, conText) => {
    const { q, mek, reply, react, botFooter, mxdBuffer } = conText;

    if (!q) {
      await react("❌");
      return reply("Please provide video url");
    }

    try {
      const buffer = await mxdBuffer(q);
      if (buffer instanceof Error) {
        await react("❌");
        return reply("Failed to download the video file.");
      }
      await Malvin.sendMessage(from, {
        document: buffer,
        fileName: "Video.mp4",
        mimetype: "video/mp4",
        caption: `> *${botFooter}*`,
      }, { quoted: mek });
      await react("✅");
    } catch (error) {
      console.error("Error:", error);
      await react("❌");
      return reply("Oops! Something went wrong. Please try again.");
    }
  },
);

// ==================== PLAY (AUDIO) ====================
mxd(
  {
    pattern: "play",
    aliases: ["ytmp3", "ytmp3doc", "audiodoc", "song"],
    category: "downloader",
    react: "🎶",
    description: "Download Audio from Youtube",
  },
  async (from, Malvin, conText) => {
    const {
      q,
      reply,
      react,
      botPic,
      botName,
      botFooter,
      mxdBuffer,
      formatAudio,
    } = conText;

    if (!q) {
      await react("❌");
      return reply("Please provide a song name");
    }

    try {
      await react("🔍");

      const result = await fetchFromClutchPlay(q, conText);

      if (!result?.audio) {
        await react("❌");
        return reply("Failed to fetch audio. Please try again.");
      }

      const title = result.title || "Audio";
      const duration = result.duration || "N/A";
      const thumbnail = result.thumbnail;
      const videoId = result.video_id || Date.now().toString();
      const watchUrl = result.url;

      const prog = await sendProgress(Malvin, from, `🎶 *Downloading:* ${title}`);
      let bufferRes;
      try {
        const chunks = [];
        await dlStream(result.audio, (c, received, total) => {
          chunks.push(c);
          if (total) prog.update(received / total * 100);
        });
        bufferRes = Buffer.concat(chunks);
        await prog.update(100);
      } catch (dlErr) {
        await prog.setText(`❌ Download failed.`);
        throw dlErr;
      }

      if (!isValidBuffer(bufferRes)) {
        await react("❌");
        return reply("Failed to download audio. Please try again later.");
      }

      // Large file — send as document
      if (bufferRes.length > 60 * 1024 * 1024) {
        await react("📄");
        const convertedBuffer = await formatAudio(bufferRes);
        await Malvin.sendMessage(from, {
          document: convertedBuffer,
          mimetype: "audio/mpeg",
          fileName: `${title}.mp3`.replace(/[^\w\s.-]/gi, ""),
          caption: `⿻ *Title:* ${title}\n⿻ *Duration:* ${duration}\n\n_File too large for audio streaming — sent as document_`,
        });
        return;
      }

      const dateNow = Date.now();
      const buttonId = `play_${videoId}_${dateNow}`;

      const buttons = [
        { id: `audio_${buttonId}`, text: "Audio 🎶" },
        { id: `doc_${buttonId}`, text: "Audio Document 📄" },
      ];
      if (watchUrl) {
        buttons.push({
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: "Watch on Youtube",
            url: watchUrl,
          }),
        });
      }

      await sendButtons(Malvin, from, {
        title: `${botName} SONG DOWNLOADER`,
        text: `⿻ *Title:* ${title}\n⿻ *Duration:* ${duration}\n\n*Select download format:*`,
        footer: botFooter,
        image: await fetchThumb(thumbnail, botPic),
        buttons,
      });

      let cachedBuffer = null;

      const handleResponse = async (event) => {
        const messageData = event.messages[0];
        if (!messageData.message) return;

        const selectedButtonId = extractButtonId(messageData.message);
        if (!selectedButtonId) return;

        const isFromSameChat = messageData.key?.remoteJid === from;
        if (!isFromSameChat || !selectedButtonId.includes(dateNow.toString())) return;

        await react("⬇️");

        try {
          if (!cachedBuffer) cachedBuffer = bufferRes;
          const convertedBuffer = await formatAudio(cachedBuffer);

          if (selectedButtonId.startsWith('audio_')) {
            await Malvin.sendMessage(from, { audio: convertedBuffer, mimetype: "audio/mpeg" }, { quoted: messageData });
          }
          else if (selectedButtonId.startsWith('doc_')) {
            await Malvin.sendMessage(from, {
              document: convertedBuffer,
              mimetype: "audio/mpeg",
              fileName: `${title}.mp3`.replace(/[^\w\s.-]/gi, ""),
              caption: title,
            }, { quoted: messageData });
          }
          await react("✅");
        } catch (error) {
          console.error("Error sending media:", error);
          await react("❌");
          await Malvin.sendMessage(from, { text: "Failed to send media. Please try again." }, { quoted: messageData });
        }
      };

      Malvin.ev.on("messages.upsert", handleResponse);
      setTimeout(() => Malvin.ev.off("messages.upsert", handleResponse), 300000);

    } catch (error) {
      console.error("Error:", error);
      await react("❌");
      return reply(`Failed to fetch audio: ${describeError(error)}`);
    }
  },
);

// ==================== VIDEO ====================
mxd(
  {
    pattern: "video",
    aliases: ["ytmp4doc", "mp4", "ytmp4", "dlmp4"],
    category: "downloader",
    react: "🎥",
    description: "Download Video from Youtube",
  },
  async (from, Malvin, conText) => {
    const {
      q,
      reply,
      react,
      botPic,
      botName,
      botFooter,
      mxdBuffer,
      formatVideo,
    } = conText;

    if (!q) {
      await react("❌");
      return reply("Please provide a video name");
    }

    try {
      await react("🔍");

      // A raw YouTube URL goes straight to youtube2; a name/search term is
      // resolved to a URL first via clutchplay's search (which also gives duration).
      let videoUrl = q;
      let durationHint = null;
      if (!YT_URL_RE.test(q)) {
        const searchResult = await fetchFromClutchPlay(q, conText);
        if (!searchResult?.url) {
          await react("❌");
          return reply("No video found for your query.");
        }
        videoUrl = searchResult.url;
        durationHint = searchResult.duration || null;
      }

      const result = await fetchYoutube2(videoUrl, conText);

      if (!result?.video) {
        await react("❌");
        return reply("Failed to fetch video. Please try again.");
      }

      const title = result.title || "Video";
      const duration = durationHint || result.duration || "N/A";
      const thumbnail = result.thumbnail;
      const videoId = result.video_id || Date.now().toString();

      // No-RAM flow (no more OOM restarts): stream to a temp file, upload to a
      // temporary host, send a temporary link. Temp file is always deleted.
      await react("⬇️");
      const prog = await sendProgress(Malvin, from, `🎥 *Downloading:* ${title}`);
      const tmpPath = path.join(os.tmpdir(), `mxd_dl_${Date.now().toString(36)}.mp4`);
      try {
        const w = fs.createWriteStream(tmpPath);
        await dlStream(result.video, (c, received, total) => {
          w.write(c);
          if (total) prog.update(received / total * 100);
        });
        await new Promise((resolve, reject) => { w.end(resolve); w.on("error", reject); });
        await prog.update(100);
        await prog.setText(`⬆️ *Uploading:* ${title}`);
        const { size } = fs.statSync(tmpPath);
        if (size < 10240) throw new Error("Downloaded file too small.");
        let link = null;
        if (size < 120 * 1024 * 1024) {
          const form = new FormData();
          form.append("files[]", fs.createReadStream(tmpPath), { filename: `${title}.mp4`.replace(/[^\w\s.-]/gi, "") || "video.mp4" });
          try {
            const up = await axios.post("https://uguu.se/upload.php?output=json", form, {
              headers: { ...form.getHeaders(), "User-Agent": "Mozilla/5.0" },
              timeout: 600000,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
            });
            link = up.data?.files?.[0]?.url || null;
          } catch (upErr) { console.error("uguu upload failed:", upErr.message); }
        }
        const sizeMB = (size / (1024 * 1024)).toFixed(1);
        const text = link
          ? `⿻ *Title:* ${title}\n⿻ *Duration:* ${duration}\n⿻ *Size:* ${sizeMB} MB\n\n🔗 *Download link (temporary, ~3h):*\n${link}`
          : `⿻ *Title:* ${title}\n⿻ *Duration:* ${duration}\n⿻ *Size:* ${sizeMB} MB\n\n🔗 *Direct link:*\n${result.video}`;
        await sendButtons(Malvin, from, {
          title: `${botName} VIDEO DOWNLOADER`,
          text,
          footer: "> XD",
          image: await fetchThumb(thumbnail, botPic),
          buttons: link
            ? [{ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📥 Download Video", url: link }) }]
            : [{ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "▶️ Watch/Download", url: result.video }) }],
        });
        await react("✅");
      } finally {
        fs.rmSync(tmpPath, { force: true });
      }

    } catch (error) {
      console.error("Error:", error);
      await react("❌");
      return reply(`Failed to fetch video: ${describeError(error)}`);
    }
  },
);
