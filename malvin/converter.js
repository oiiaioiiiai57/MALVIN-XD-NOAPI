const { mxd, toAudio, toVideo, toPtt, stickerToImage, mxdFancy, mxdRandom, getSetting, runFFmpeg, getVideoDuration, mxdSticker } = require("../king");
const fs = require("fs").promises;
const { StickerTypes } = require("wa-sticker-formatter");
const { mrxd } = require('../king/mrxd');
const axios = require("axios");
const sharp = require("sharp");
const { classifyApiError } = require("../king/mxdcore2");
const { fancy } = require("../king/fancyFont");

const escXml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function bratBuffer(text, style = "white", blur = false) {
    const bg = style === "black" ? "#000000" : style === "green" ? "#8ACE00" : "#ffffff";
    const fg = style === "black" ? "#ffffff" : "#000000";
    const words = String(text || "").slice(0, 200).split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
        if ((cur + " " + w).trim().length > 22) { lines.push(cur.trim()); cur = w; }
        else cur += " " + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    const shown = lines.slice(0, 8).map(escXml).join("</tspan><tspan x=\"60\" dy=\"72\">");
    const svg = `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="800" fill="${bg}"/><text x="60" y="200" font-family="Arial,sans-serif" font-size="64" fill="${fg}" filter="url(#b)"><tspan x="60" dy="0">${shown}</tspan></text><defs><filter id="b"><feGaussianBlur stdDeviation="${blur ? 1.6 : 0.4}"/></filter></defs></svg>`;
    let img = sharp(Buffer.from(svg));
    if (blur) img = img.blur(1.2);
    return img.png().toBuffer();
}

mxd({
    pattern: "sticker",
    aliases: ["st", "take"],
    category: "converter",
    react: "🔄️",
    description: "Convert image/video/sticker to sticker.",
}, async (from, Malvin, conText) => {
    const { q, mek, reply, react, quoted, packName, packAuthor } = conText;

    try {
        if (!quoted) {
            await react("❌");
            return reply("Please reply to/quote an image, video or sticker");
        }

        const quotedImg = quoted?.imageMessage || quoted?.message?.imageMessage;
        const quotedSticker = quoted?.stickerMessage || quoted?.message?.stickerMessage;
        const quotedVideo = quoted?.videoMessage || quoted?.message?.videoMessage;

        if (!quotedImg && !quotedSticker && !quotedVideo) {
            await react("❌");
            return reply("That quoted message is not an image, video or sticker");
        }

        let tempFilePath;
        try {
            if (quotedImg || quotedVideo) {
                tempFilePath = await Malvin.downloadAndSaveMediaMessage(
                    quotedImg || quotedVideo,
                    "temp_media"
                );

                let fileExt = quotedImg ? ".jpg" : ".mp4";
                let mediaFile = mxdRandom(fileExt);
                const data = await fs.readFile(tempFilePath);
                await fs.writeFile(mediaFile, data);

                // 🔥 If video → convert to webp
                if (quotedVideo) {
                    const compressedFile = mxdRandom(".webp");
                    let duration = 8; // default duration
                    
                    try {
                        duration = await getVideoDuration(mediaFile);
                        if (duration > 10) duration = 10; // trim to first 10 seconds
                    } catch (e) {
                        console.error("Using default duration due to error:", e);
                    }
                    
                    await runFFmpeg(mediaFile, compressedFile, 320, 15, duration);
                    await fs.unlink(mediaFile).catch(() => {});
                    mediaFile = compressedFile;
                }

                const stickerBuffer = await mxdSticker(mediaFile, {
                    pack: packName || fancy("malvin-xd", "smallcaps"), 
                    author: packAuthor || fancy("malvin tech", "smallcaps"),
                    type: q.includes("--crop") || q.includes("-c") ? StickerTypes.CROPPED : StickerTypes.FULL,
                    categories: ["🤩", "🎉"],
                    id: "12345",
                    quality: 75,
                    background: "transparent"
                });

                await fs.unlink(mediaFile).catch(() => {});
                await react("✅");
                return Malvin.sendMessage(from, { sticker: stickerBuffer }, { quoted: mrxd});

            } else if (quotedSticker) {
                // Sticker → Sticker (recompress if too big)
                tempFilePath = await Malvin.downloadAndSaveMediaMessage(quotedSticker, "temp_media");
                const stickerData = await fs.readFile(tempFilePath);
                const stickerFile = mxdRandom(".webp");
                await fs.writeFile(stickerFile, stickerData);

                const newStickerBuffer = await mxdSticker(stickerFile, {
                    pack: packName || fancy("malvin-xd", "smallcaps"), 
                    author: packAuthor || fancy("malvin tech", "smallcaps"),
                    type: q.includes("--crop") || q.includes("-c") ? StickerTypes.CROPPED : StickerTypes.FULL,
                    categories: ["🤩", "🎉"],
                    id: "12345",
                    quality: 75,
                    background: "transparent"
                });

                await fs.unlink(stickerFile).catch(() => {});
                await react("✅");
                return Malvin.sendMessage(from, { sticker: newStickerBuffer }, { quoted: mrxd });
            }
        } finally {
            if (tempFilePath) await fs.unlink(tempFilePath).catch(() => {});
        }
    } catch (e) {
        console.error("Error in sticker command:", e);
        await react("❌");
        await reply("Failed to convert to sticker");
    }
});


mxd({
    pattern: "toimg",
    aliases: ["s2img"],
    category: "converter",
    react: "🔄️",
    description: "Convert Sticker to Image.",
}, async (from, Malvin, conText) => {
    const { mek, reply, sender, botName, react, quoted, botFooter, quotedMsg, newsletterJid } = conText;

    try {
        if (!quotedMsg) {
            await react("❌");
            return reply("Please reply to/quote a sticker");
        }
        
        const quotedSticker = quoted?.stickerMessage || quoted?.message?.stickerMessage;
        if (!quotedSticker) {
            await react("❌");
            return reply("That quoted message is not a sticker");
        }
        
        let tempFilePath;
        try {
            tempFilePath = await Malvin.downloadAndSaveMediaMessage(quotedSticker, 'temp_media');
            const stickerBuffer = await fs.readFile(tempFilePath);
            const imageBuffer = await stickerToImage(stickerBuffer);  
        await Malvin.sendMessage(
        from,
        {
          image: imageBuffer,
          caption: `*Here is your image*\n\n> *${botFooter}*`,
          contextInfo: {
            mentionedJid: [sender],
            forwardingScore: 5,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: newsletterJid,
              newsletterName: botName,
              serverMessageId: 143
            },
          },
        },
        { quoted: mrxd }
      );
            await react("✅");
        } finally {
            if (tempFilePath) await fs.unlink(tempFilePath).catch(console.error);
        }
    } catch (e) {
        console.error("Error in toimg command:", e);
        await react("❌");
        await reply("Failed to convert sticker to image");
    }
});


mxd({
    pattern: "toaudio",
    aliases: ['tomp3'],
    category: "converter",
    react: "🔄️",
    description: "Convert video to audio"
  },
  async (from, Malvin, conText) => {
    const { mek, reply, react, botPic, quoted, quotedMsg, newsletterUrl } = conText;

    if (!quotedMsg) {
      await react("❌");
      return reply("Please reply to a video message");
    }

    const quotedVideo = quoted?.videoMessage || quoted?.message?.videoMessage || quoted?.pvtMessage || quoted?.message?.pvtMessage;
    
    if (!quotedVideo) {
      await react("❌");
      return reply("The quoted message doesn't contain any video");
    }

    let tempFilePath;
    try {
      tempFilePath = await Malvin.downloadAndSaveMediaMessage(quotedVideo, 'temp_media');
      const buffer = await fs.readFile(tempFilePath);
      const convertedBuffer = await toAudio(buffer);
      
      await Malvin.sendMessage(from, {
        audio: convertedBuffer,
        mimetype: "audio/mpeg",
        externalAdReply: {
          title: 'Converted Audio',
          body: 'Video to Audio',
          mediaType: 1,
          thumbnailUrl: botPic,
          sourceUrl: newsletterUrl,
          renderLargerThumbnail: false,
          showAdAttribution: true,
        }
      }, { quoted: mrxd });
      
      await react("✅");
    } catch (e) {
      console.error("Error in toaudio command:", e);
      await react("❌");
      const errMsg = e.message || String(e);
      if (errMsg.includes('no audio')) {
        await reply("This video has no audio track to extract.");
      } else {
        await reply("Failed to convert video to audio");
      }
    } finally {
      if (tempFilePath) await fs.unlink(tempFilePath).catch(console.error);
    }
  }
);


mxd({
    pattern: "toptt",
    aliases: ['tovoice', 'tovn', 'tovoicenote'],
    category: "converter",
    react: "🎙️",
    description: "Convert audio to WhatsApp voice note"
  },
  async (from, Malvin, conText) => {
    const { mek, reply, react, botPic, quoted, quotedMsg } = conText;

    if (!quotedMsg) {
      await react("❌");
      return reply("Please reply to an audio message");
    }

    const quotedAudio = quoted?.audioMessage || quoted?.message?.audioMessage;
    
    if (!quotedAudio) {
      await react("❌");
      return reply("The quoted message doesn't contain any audio");
    }

    let tempFilePath;
    try {
      tempFilePath = await Malvin.downloadAndSaveMediaMessage(quotedAudio, 'temp_media');
      const buffer = await fs.readFile(tempFilePath);
      const convertedBuffer = await toPtt(buffer);
      
      await Malvin.sendMessage(from, {
        audio: convertedBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      }, { quoted: mrxd });
      
      await react("✅");
    } catch (e) {
      console.error("Error in toptt command:", e);
      await react("❌");
      await reply("Failed to convert to voice note");
    } finally {
      if (tempFilePath) await fs.unlink(tempFilePath).catch(console.error);
    }
  }
);


mxd({
    pattern: "tovideo",
    aliases: ['tomp4', 'tovid', 'toblackscreen', 'blackscreen'],
    category: "converter",
    react: "🎥",
    description: "Convert audio to video with black screen"
  },
  async (from, Malvin, conText) => {
    const { mek, reply, react, botPic, quoted, quotedMsg } = conText;

    if (!quotedMsg) {
      await react("❌");
      return reply("Please reply to an audio message");
    }

    const quotedAudio = quoted?.audioMessage || quoted?.message?.audioMessage;
    
    if (!quotedAudio) {
      await react("❌");
      return reply("The quoted message doesn't contain any audio");
    }

    let tempFilePath;
    try {
      tempFilePath = await Malvin.downloadAndSaveMediaMessage(quotedAudio, 'temp_media');
      const buffer = await fs.readFile(tempFilePath);
      const convertedBuffer = await toVideo(buffer);
      
      await Malvin.sendMessage(from, {
        video: convertedBuffer,
        mimetype: "video/mp4",
        caption: 'Converted Video',
      }, { quoted: mrxd });
      
      await react("✅");
    } catch (e) {
      console.error("Error in tovideo command:", e);
      await react("❌");
      await reply("Failed to convert audio to video");
    } finally {
      if (tempFilePath) await fs.unlink(tempFilePath).catch(console.error);
    }
  }
);

// ==================== BRAT STICKER ====================
mxd(
    {
        pattern: "brat",
        category: "sticker",
        react: "🎨",
        aliases: ["brateffect"],
        description: "Generate Brat text effect image",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, botFooter } = conText;

        if (!q) {
            await react("❌");
            return reply("Usage: .brat <text> | <style: green|white|black> | <blur: true|false>\n\n*Example:* .brat Hello");
        }

        const [text, style, blur] = q.split("|").map(s => s.trim());

        try {
            await react("🎨");
            // Local generation (no API key): sharp SVG, brat album style.
            const buf = await bratBuffer(text, (style || "white").toLowerCase(), blur === "true");

            await Malvin.sendMessage(from, {
                image: buf,
                caption: `🎨 *Brat Text Effect*\n📝 ${text}\n\n> *${botFooter}*`
            }, { quoted: mek });

            await react("✅");
        } catch (error) {
            console.error("Brat error:", error.message);
            await react("❌");
            reply(`Failed to generate Brat text effect: ${error.message}`);
        }
    }
);
// ==================== BRAT ANIMATED ====================
mxd(
    {
        pattern: "brat2",
        category: "sticker",
        react: "🎨",
        aliases: ["bratanim"],
        description: "Generate animated Brat text effect (words reveal one by one)",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, botFooter } = conText;

        if (!q) {
            await react("❌");
            return reply("Usage: .brat2 <text (max 10 words)> | <style> | <speed: slow|normal|fast>\n\n*Example:* .brat2 Hello there");
        }

        const [text, style] = q.split("|").map(s => s.trim());

        try {
            await react("🎨");
            // No-key fallback: animated endpoint has no free equivalent,
            // send the static local version instead.
            const buf = await bratBuffer(text, (style || "white").toLowerCase(), true);

            await Malvin.sendMessage(from, {
                image: buf,
                caption: `🎨 *Brat Text Effect (static fallback)*\n📝 ${text}\n\n> *${botFooter}*`
            }, { quoted: mek });

            await react("✅");
        } catch (error) {
            console.error("Bratanim error:", error.message);
            await react("❌");
            reply(`Failed to generate animated Brat text effect: ${error.message}`);
        }
    }
);

// ==================== QUOTE CHAT BUBBLE (QC) ====================
mxd(
    {
        pattern: "qc",
        category: "sticker",
        react: "💬",
        aliases: ["quotly"],
        description: "Generate a Telegram-style quote chat bubble image",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, botFooter, sender } = conText;

        if (!q) {
            await react("❌");
            return reply("Usage: .qc <username> | <text> | <avatar_url> | <color hex> | <bubble: dark|white|black>\n\n*Example:* .qc Malvin | hello there, how are you");
        }

        const [username, text, avatar, color, bubble] = q.split("|").map(s => s.trim());
        if (!username || !text) {
            await react("❌");
            return reply("Missing: username and text (both required)");
        }

        try {
            await react("💬");
            // Free quotly API (no key): bot.lyo.su
            const bg = bubble === "white" ? "#ffffff" : bubble === "black" ? "#000000" : "#1b1429";
            const payload = {
                type: "quote", format: "png", backgroundColor: bg, width: 512, height: 768, scale: 2,
                messages: [{
                    entities: [], avatar: true,
                    from: { id: 1, name: username.slice(0, 40), photo: { url: avatar || `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(username)}` } },
                    text: text.slice(0, 500), replyMessage: {},
                }],
            };
            const res = await axios.post("https://bot.lyo.su/quote/generate", payload, { timeout: 30000, headers: { "Content-Type": "application/json" } });
            const b64 = res.data?.result?.image;
            if (!b64) throw new Error("quotly returned no image");
            const buf = Buffer.from(b64, "base64");

            await Malvin.sendMessage(from, {
                image: buf,
                caption: `> *${botFooter}*`
            }, { quoted: mek });

            await react("✅");
        } catch (error) {
            console.error("QC error:", error.message);
            await react("❌");
            reply(`Failed to generate quote card: ${error.message}`);
        }
    }
);

// ==================== FAKE iMESSAGE SCREENSHOT (IQC) ====================
mxd(
    {
        pattern: "iqc",
        category: "sticker",
        react: "📱",
        aliases: ["imessage", "fakeimessage"],
        description: "Generate a fake iMessage press-and-hold screenshot",
    },
    async (from, Malvin, conText) => {
        const { q, mek, reply, react, botFooter } = conText;

        if (!q) {
            await react("❌");
            return reply("Usage: .iqc <text> | <time> | <clock> | <bubble: gray|blue|green|hex>\nSupports *bold* _italic_ ~strike~\n\n*Example:* .iqc Hello there");
        }

        const [text, time, clock, bubble] = q.split("|").map(s => s.trim());

        try {
            await react("📱");
            // Local iMessage-style bubble (no API key) via sharp SVG.
            const bubbleColor = bubble === "blue" ? "#0a84ff" : bubble === "green" ? "#30d158" : bubble?.startsWith("#") ? bubble : "#e9e9eb";
            const fg = bubbleColor.toLowerCase() === "#e9e9eb" ? "#000000" : "#ffffff";
            const label = `${time || ""}${clock ? "  " + clock : ""}`.trim();
            const svg = `<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" fill="#000000"/><rect x="80" y="120" width="640" height="220" rx="48" fill="${bubbleColor}"/><text x="120" y="230" font-family="Arial,sans-serif" font-size="40" fill="${fg}">${escXml(text.slice(0, 400))}</text><text x="400" y="400" font-family="Arial,sans-serif" font-size="30" fill="#999999" text-anchor="middle">${escXml(label)}</text></svg>`;
            const buf = await sharp(Buffer.from(svg)).png().toBuffer();

            await Malvin.sendMessage(from, {
                image: buf,
                caption: `> *${botFooter}*`
            }, { quoted: mek });

            await react("✅");
        } catch (error) {
            console.error("IQC error:", error.message);
            await react("❌");
            reply(`Failed to generate fake chat: ${error.message}`);
        }
    }
);



