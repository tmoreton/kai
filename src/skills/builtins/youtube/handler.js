/**
 * YouTube Data API v3 Skill Handler
 *
 * Ported from src/agents/integrations/youtube.ts
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const FETCH_TIMEOUT_MS = 15000;

function getApiKey(config) {
  const key = config.api_key || process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY not configured. Set it in ~/.kai/.env or environment.");
  return key;
}

async function youtubeApi(endpoint, params, apiKey) {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`YouTube API error (${response.status}): ${err}`);
  }
  return response.json();
}

let _config = {};

export default {
  install: async (config) => { _config = config; },

  actions: {
    search_videos: async (params) => {
      const apiKey = getApiKey(_config);
      const data = await youtubeApi("search", {
        part: "snippet",
        q: params.query || "",
        type: "video",
        order: params.order || "relevance",
        maxResults: String(params.max_results || 10),
        publishedAfter: params.published_after || "",
        ...(params.channel_id ? { channelId: params.channel_id } : {}),
      }, apiKey);

      const results = data.items?.map(item => ({
        video_id: item.id?.videoId,
        title: item.snippet?.title,
        description: item.snippet?.description,
        channel: item.snippet?.channelTitle,
        published_at: item.snippet?.publishedAt,
        thumbnail: item.snippet?.thumbnails?.high?.url,
      })) || [];
      return JSON.stringify(results, null, 2);
    },

    get_video_stats: async (params) => {
      const apiKey = getApiKey(_config);
      const videoIds = Array.isArray(params.video_ids) ? params.video_ids.join(",") : params.video_ids;
      const data = await youtubeApi("videos", {
        part: "statistics,snippet,contentDetails",
        id: videoIds,
      }, apiKey);

      const results = data.items?.map(item => ({
        video_id: item.id,
        title: item.snippet?.title,
        channel: item.snippet?.channelTitle,
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
        comments: Number(item.statistics?.commentCount || 0),
        duration: item.contentDetails?.duration,
        tags: item.snippet?.tags || [],
        published_at: item.snippet?.publishedAt,
      })) || [];
      return JSON.stringify(results, null, 2);
    },

    get_channel: async (params) => {
      const apiKey = getApiKey(_config);
      const data = await youtubeApi("channels", {
        part: "statistics,snippet,contentDetails",
        ...(params.channel_id ? { id: params.channel_id } : {}),
        ...(params.username ? { forUsername: params.username } : {}),
      }, apiKey);

      const results = data.items?.map(item => ({
        channel_id: item.id,
        title: item.snippet?.title,
        description: item.snippet?.description,
        subscribers: Number(item.statistics?.subscriberCount || 0),
        total_views: Number(item.statistics?.viewCount || 0),
        video_count: Number(item.statistics?.videoCount || 0),
        uploads_playlist: item.contentDetails?.relatedPlaylists?.uploads,
      })) || [];
      return JSON.stringify(results, null, 2);
    },

    get_recent_uploads: async (params) => {
      const apiKey = getApiKey(_config);
      const channelData = await youtubeApi("channels", {
        part: "contentDetails",
        id: params.channel_id,
      }, apiKey);

      const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) return "[]";

      const playlistData = await youtubeApi("playlistItems", {
        part: "snippet",
        playlistId: uploadsPlaylistId,
        maxResults: String(params.max_results || 10),
      }, apiKey);

      const videoIds = playlistData.items
        ?.map(item => item.snippet?.resourceId?.videoId)
        .filter(Boolean)
        .join(",");
      if (!videoIds) return "[]";

      const videoData = await youtubeApi("videos", {
        part: "statistics,snippet,contentDetails",
        id: videoIds,
      }, apiKey);

      const results = videoData.items?.map(item => ({
        video_id: item.id,
        title: item.snippet?.title,
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
        comments: Number(item.statistics?.commentCount || 0),
        published_at: item.snippet?.publishedAt,
        tags: item.snippet?.tags || [],
        thumbnail: item.snippet?.thumbnails?.high?.url,
      })) || [];
      return JSON.stringify(results, null, 2);
    },

    get_trending: async (params) => {
      const apiKey = getApiKey(_config);
      const data = await youtubeApi("videos", {
        part: "statistics,snippet",
        chart: "mostPopular",
        regionCode: params.region || "US",
        maxResults: String(params.max_results || 10),
        ...(params.category_id ? { videoCategoryId: params.category_id } : {}),
      }, apiKey);

      const results = data.items?.map(item => ({
        video_id: item.id,
        title: item.snippet?.title,
        channel: item.snippet?.channelTitle,
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
      })) || [];
      return JSON.stringify(results, null, 2);
    },
  },
};
