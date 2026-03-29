import { registerIntegration, type WorkflowContext } from "../workflow.js";

/**
 * YouTube Data API Integration
 *
 * Requires YOUTUBE_API_KEY in env.
 * API docs: https://developers.google.com/youtube/v3
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey(ctx: WorkflowContext): string {
  let key = ctx.config.youtube_api_key || ctx.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;

  // Fallback: read directly from ~/.kai/.env if not in process.env
  if (!key) {
    try {
      const fs = require("fs");
      const path = require("path");
      const envPath = path.join(process.env.HOME || "~", ".kai/.env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/YOUTUBE_API_KEY=(.+)/);
        if (match) key = match[1].trim();
      }
    } catch {}
  }

  if (!key) throw new Error("YOUTUBE_API_KEY not configured. Set it in ~/.kai/.env or workflow config.");
  return key;
}

async function youtubeApi(endpoint: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`YouTube API error (${response.status}): ${err}`);
  }

  return response.json();
}

export function registerYouTubeIntegration(): void {
  registerIntegration({
    name: "youtube",
    description: "YouTube Data API v3 — search videos, get channel stats, analyze trends",
    actions: {
      // Search for videos
      search_videos: async (params, ctx) => {
        const apiKey = getApiKey(ctx);
        const data = await youtubeApi("search", {
          part: "snippet",
          q: params.query || "",
          type: "video",
          order: params.order || "relevance",
          maxResults: String(params.max_results || 10),
          publishedAfter: params.published_after || "",
          ...(params.channel_id ? { channelId: params.channel_id } : {}),
        }, apiKey);

        return data.items?.map((item: any) => ({
          video_id: item.id?.videoId,
          title: item.snippet?.title,
          description: item.snippet?.description,
          channel: item.snippet?.channelTitle,
          published_at: item.snippet?.publishedAt,
          thumbnail: item.snippet?.thumbnails?.high?.url,
        })) || [];
      },

      // Get video statistics
      get_video_stats: async (params, ctx) => {
        const apiKey = getApiKey(ctx);
        const videoIds = Array.isArray(params.video_ids)
          ? params.video_ids.join(",")
          : params.video_ids;

        const data = await youtubeApi("videos", {
          part: "statistics,snippet,contentDetails",
          id: videoIds,
        }, apiKey);

        return data.items?.map((item: any) => ({
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
      },

      // Get channel info
      get_channel: async (params, ctx) => {
        const apiKey = getApiKey(ctx);
        const data = await youtubeApi("channels", {
          part: "statistics,snippet,contentDetails",
          ...(params.channel_id ? { id: params.channel_id } : {}),
          ...(params.username ? { forUsername: params.username } : {}),
        }, apiKey);

        return data.items?.map((item: any) => ({
          channel_id: item.id,
          title: item.snippet?.title,
          description: item.snippet?.description,
          subscribers: Number(item.statistics?.subscriberCount || 0),
          total_views: Number(item.statistics?.viewCount || 0),
          video_count: Number(item.statistics?.videoCount || 0),
          uploads_playlist: item.contentDetails?.relatedPlaylists?.uploads,
        })) || [];
      },

      // Get recent uploads from a channel
      get_recent_uploads: async (params, ctx) => {
        const apiKey = getApiKey(ctx);
        // First get the uploads playlist ID
        const channelData = await youtubeApi("channels", {
          part: "contentDetails",
          id: params.channel_id,
        }, apiKey);

        const uploadsPlaylistId =
          channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) return [];

        // Get playlist items
        const playlistData = await youtubeApi("playlistItems", {
          part: "snippet",
          playlistId: uploadsPlaylistId,
          maxResults: String(params.max_results || 10),
        }, apiKey);

        const videoIds = playlistData.items
          ?.map((item: any) => item.snippet?.resourceId?.videoId)
          .filter(Boolean)
          .join(",");

        if (!videoIds) return [];

        // Get full video stats
        const videoData = await youtubeApi("videos", {
          part: "statistics,snippet,contentDetails",
          id: videoIds,
        }, apiKey);

        return videoData.items?.map((item: any) => ({
          video_id: item.id,
          title: item.snippet?.title,
          views: Number(item.statistics?.viewCount || 0),
          likes: Number(item.statistics?.likeCount || 0),
          comments: Number(item.statistics?.commentCount || 0),
          published_at: item.snippet?.publishedAt,
          tags: item.snippet?.tags || [],
          thumbnail: item.snippet?.thumbnails?.high?.url,
        })) || [];
      },

      // Get trending videos in a category
      get_trending: async (params, ctx) => {
        const apiKey = getApiKey(ctx);
        const data = await youtubeApi("videos", {
          part: "statistics,snippet",
          chart: "mostPopular",
          regionCode: params.region || "US",
          maxResults: String(params.max_results || 10),
          ...(params.category_id ? { videoCategoryId: params.category_id } : {}),
        }, apiKey);

        return data.items?.map((item: any) => ({
          video_id: item.id,
          title: item.snippet?.title,
          channel: item.snippet?.channelTitle,
          views: Number(item.statistics?.viewCount || 0),
          likes: Number(item.statistics?.likeCount || 0),
        })) || [];
      },
    },
  });
}
