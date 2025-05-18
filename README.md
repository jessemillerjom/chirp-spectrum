# Chirp Spectrum

A Cloudflare Workers application that collects and analyzes AI-related tweets using sentiment analysis. The application provides a historical dashboard showing sentiment trends and detailed analysis of AI-related discussions on Twitter.

## Demo

![Chirp Spectrum Demo](./demo.gif)

## Features

- Collects tweets related to AI companies and technologies
- Performs multi-aspect sentiment analysis using Mistral AI
- Interactive dashboard with sentiment trends visualization
- Detailed tweet analysis with technological, societal, and ethical aspects
- Historical data collection with rate limiting and error handling
- Cancellable collection process
- Mobile-friendly UI with side panel for tweet details

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [Twitter API Access](https://developer.twitter.com/en/docs/authentication/oauth-2-0/bearer-tokens) (Basic tier or above required)
  - The free tier does not provide access to the search endpoints needed for this application
  - You'll need at least the Basic ($100/month) plan to use the search/recent endpoint
- [Mistral AI API Key](https://mistral.ai/)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/chirp-spectrum.git
   cd chirp-spectrum
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a KV namespace:
   ```bash
   wrangler kv:namespace create AI_SENTIMENT_TWEETS
   ```

4. Update the KV namespace ID in `wrangler.toml` with the ID from step 3.

5. Set up environment variables:
   ```bash
   wrangler secret put TWITTER_BEARER_TOKEN
   wrangler secret put MISTRAL_KEY
   ```

6. Deploy the worker:
   ```bash
   wrangler deploy
   ```

## Usage

### Data Collection

- Start collection: `GET /collect`
- Check status: `GET /collection-status`
- Cancel collection: `GET /cancel-collection`

### Data Analysis

- Get sentiment data: `GET /sentiment?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&metric=[sentiment|technological|societal|ethical]`
- Get tweets by date and sentiment: `GET /tweets?date=YYYY-MM-DD&sentiment=[POSITIVE|NEGATIVE|NEUTRAL|VERY_POSITIVE|VERY_NEGATIVE]`

## Rate Limiting

- Twitter API: Maximum 180 requests per 15-minute window
- Mistral API: 10 requests per minute with exponential backoff
- KV Storage: Daily write limits apply based on your Cloudflare plan

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- Sentiment analysis powered by [Mistral AI](https://mistral.ai/)
- Data source: [Twitter API v2](https://developer.twitter.com/en/docs/twitter-api) 
