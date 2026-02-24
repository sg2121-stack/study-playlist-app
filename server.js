require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static("public"));

const API_KEY = process.env.YOUTUBE_API_KEY;

/* ---------------- DURATION ---------------- */
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = parseInt(match?.[1] || 0);
  const minutes = parseInt(match?.[2] || 0);
  const seconds = parseInt(match?.[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/* ---------------- LEVEL DETECTION ---------------- */
function detectLevel(title) {
  title = title.toLowerCase();

  if (
    title.includes("beginner") ||
    title.includes("basics") ||
    title.includes("from scratch") ||
    title.includes("introduction")
  ) return "beginner";

  if (
    title.includes("advanced") ||
    title.includes("expert") ||
    title.includes("project") ||
    title.includes("deep dive")
  ) return "advanced";

  return "intermediate";
}

/* ---------------- COMMENT ANALYSIS ---------------- */
async function getCommentScore(videoId) {
  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/commentThreads",
      {
        params: {
          part: "snippet",
          videoId,
          maxResults: 50,
          key: API_KEY
        }
      }
    );

    let score = 0;

    res.data.items.forEach(c => {
      const text =
        c.snippet.topLevelComment.snippet.textDisplay.toLowerCase();

      // positive learning signals
      if (text.includes("best")) score += 5;
      if (text.includes("helped")) score += 5;
      if (text.includes("clear")) score += 4;
      if (text.includes("understand")) score += 4;
      if (text.includes("great")) score += 3;
      if (text.includes("amazing")) score += 3;
      if (text.includes("finally")) score += 3;

      // negative signals
      if (text.includes("waste")) score -= 5;
      if (text.includes("confusing")) score -= 4;
      if (text.includes("bad")) score -= 3;
      if (text.includes("boring")) score -= 2;
    });

    return score;
  } catch (err) {
    return 0; // comments disabled or API limit
  }
}

/* ---------------- SEARCH ROUTE ---------------- */
app.get("/search", async (req, res) => {
  const topic = req.query.q;

  try {
    /* ---------- search videos ---------- */
    const searchRes = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          part: "snippet",
          q: topic + " tutorial",
          key: API_KEY,
          maxResults: 15,
          type: "video"
        }
      }
    );

    const videos = searchRes.data.items;
    const ids = videos.map(v => v.id.videoId).join(",");

    /* ---------- stats ---------- */
    const statsRes = await axios.get(
      "https://www.googleapis.com/youtube/v3/videos",
      {
        params: {
          part: "statistics,contentDetails",
          id: ids,
          key: API_KEY
        }
      }
    );

    const statsMap = {};
    statsRes.data.items.forEach(v => {
      statsMap[v.id] = {
        views: parseInt(v.statistics.viewCount || 0),
        duration: v.contentDetails.duration
      };
    });

    /* ---------- merge ---------- */
    let finalVideos = videos.map(v => {
      const id = v.id.videoId;
      const title = v.snippet.title;
      const duration = statsMap[id]?.duration || "";

      return {
        id,
        title,
        channel: v.snippet.channelTitle,
        views: statsMap[id]?.views || 0,
        durationSeconds: parseDuration(duration),
        level: detectLevel(title),
        commentScore: 0
      };
    });

    /* remove shorts */
    finalVideos = finalVideos.filter(v => v.durationSeconds > 300);

    /* ---------- comment scoring (top 8 videos only for speed) ---------- */
    for (let v of finalVideos.slice(0, 8)) {
      v.commentScore = await getCommentScore(v.id);
    }

    /* ---------- final scoring ---------- */
    finalVideos.forEach(v => {
      v.score =
        v.views / 1000 +
        v.durationSeconds / 60 +
        v.commentScore * 15; // comment weight
    });

    finalVideos.sort((a, b) => b.score - a.score);

    /* ---------- curriculum grouping ---------- */
    const curriculum = {
      beginner: finalVideos.filter(v => v.level === "beginner").slice(0, 2),
      intermediate: finalVideos.filter(v => v.level === "intermediate").slice(0, 2),
      advanced: finalVideos.filter(v => v.level === "advanced").slice(0, 2)
    };

    res.json({ videos: finalVideos.slice(0, 6), curriculum });

  } catch (err) {
    console.log(err.message);
    res.status(500).send("Server error");
  }
});

/* ---------------- SERVER ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Smart comment-ranked server running on ${PORT}`);
});