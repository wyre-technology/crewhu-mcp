# Crewhu MCP Server

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

A Model Context Protocol (MCP) server for Crewhu — customer feedback, employee engagement, and gamification platform. Enables AI assistants to manage surveys, badges, prizes, and user engagement data.

This is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects Claude (or any MCP-compatible AI) to your Crewhu environment.

> **Part of the [MSP Claude Plugins](https://github.com/wyre-technology) ecosystem** — a growing suite of AI integrations for the MSP stack. Built by MSPs, for MSPs.

## Installation

```bash
npm install @wyre-technology/crewhu-mcp
```

## Configuration

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `CREWHU_API_TOKEN` | Yes | Your Crewhu API token |
| `MCP_TRANSPORT` | No | Transport mode: stdio (default) or http |

## Usage

### Running with Claude Desktop

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "crewhu-mcp": {
      "command": "npx",
      "args": ["@wyre-technology/crewhu-mcp"],
      "env": {
        "CREWHU_API_TOKEN": "your-crewhu-api-token"
      }
    }
  }
}
```

### Running with Claude Code (CLI)

```bash
claude mcp add crewhu-mcp \
  -e CREWHU_API_TOKEN=your-value \
  -- npx -y @wyre-technology/crewhu-mcp
```

### Docker

```bash
docker build -t crewhu-mcp .
docker run \
  -e CREWHU_API_TOKEN=your-value \
  -p 8080:8080 crewhu-mcp
```

## Available Domains

### Badges
Manage and award employee badges

### Prizes
Manage prize catalog and redemptions

### Surveys
Create and manage customer satisfaction surveys

### Users
User management and engagement data


## Development

```bash
# Clone the repository
git clone https://github.com/wyre-technology/crewhu-mcp.git
cd crewhu-mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) if present, or open an issue to discuss changes.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
