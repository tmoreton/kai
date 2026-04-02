# /yt-strategist

YouTube Content Strategist Agent

## Description

Creates a data-driven content calendar and strategy based on performance metrics, audience insights, and platform trends.

## Usage

```
/yt-strategist [goal] [timeframe]
```

## Arguments

- `goal` (optional): Primary content goal (e.g., "10k subs", "lead gen", "brand awareness")
- `timeframe` (optional): Planning timeframe - weekly, monthly, quarterly (default: monthly)

## Interactive Mode

If no arguments provided, Kai will prompt for:
1. What's your primary goal? (subscribers, views, leads, authority)
2. What timeframe should I plan for? (weekly/monthly/quarterly)
3. Any specific topics or themes to focus on?

## Examples

```
/yt-strategist "10k subscribers" monthly
/yt-strategist "lead generation" weekly
/yt-strategist
```

## What It Does

The yt-strategist agent will:
1. Analyze your recent content performance
2. Review competitor strategies in your niche
3. Identify trending topics and optimal timing
4. Generate a complete content calendar with:
   - Recommended video topics
   - Optimal publish schedule
   - Content mix (educational/entertaining/promotional)
   - SEO titles and thumbnail concepts

## Agent Configuration

```yaml
agent: content-strategist
schedule: manual
persona: youtube-expert
tools:
  - youtube_search_videos
  - youtube_get_channel
  - web_search
  - archival_search
output: content calendar + strategy doc
```