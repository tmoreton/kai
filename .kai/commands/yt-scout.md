# /yt-scout

YouTube Trend & Competitor Scout Agent

## Description

Runs the YouTube scout agent that analyzes trending videos, competitor channels, and viral content patterns in a specific niche.

## Usage

```
/yt-scout [niche] [max-results]
```

## Arguments

- `niche` (optional): The content niche to scout (e.g., "AI coding", "productivity", "no-code")
- `max-results` (optional): Maximum number of results to analyze (default: 10)

## Interactive Mode

If no arguments provided, Kai will prompt for:
1. What niche/topic should I scout? 
2. How many trending videos to analyze? (default: 10)

## Examples

```
/yt-scout "AI tools" 15
/yt-scout productivity
/yt-scout
```

## What It Does

The yt-scout agent will:
1. Search YouTube for trending videos in your niche
2. Analyze competitor channels
3. Extract viral content patterns
4. Generate content opportunity report with:
   - Trending topics and keywords
   - Competitor performance metrics
   - Content gaps and opportunities
   - Recommended video angles

## Agent Configuration

```yaml
agent: youtube
schedule: manual
tools:
  - youtube_search_videos
  - youtube_get_channel
  - youtube_get_recent_uploads
  - web_search
output: markdown report
```