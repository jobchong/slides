#!/bin/bash
set -e

# Slide AI - One-Button Deployment Script
# Deploys to Fly.io with a single command

echo "🚀 Slide AI Deployment"
echo "======================"

# Check for flyctl
if ! command -v fly &> /dev/null; then
    echo "❌ Fly CLI not found. Install it with:"
    echo "   curl -L https://fly.io/install.sh | sh"
    echo ""
    echo "Then run: fly auth login"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo "❌ Not logged into Fly.io. Run: fly auth login"
    exit 1
fi

echo "✓ Fly CLI found and authenticated"

# Check for required secrets
check_secret() {
    if ! fly secrets list 2>/dev/null | grep -q "$1"; then
        echo "⚠️  Secret $1 not set"
        return 1
    fi
    return 0
}

echo ""
echo "Checking required secrets..."

MISSING_SECRETS=0

if ! check_secret "ANTHROPIC_API_KEY"; then
    echo "   Set with: fly secrets set ANTHROPIC_API_KEY=sk-ant-..."
    MISSING_SECRETS=1
fi

if ! check_secret "GROQ_API_KEY"; then
    echo "   Set with: fly secrets set GROQ_API_KEY=gsk_..."
    MISSING_SECRETS=1
fi

if [ $MISSING_SECRETS -eq 1 ]; then
    echo ""
    echo "Set the missing secrets above, then run this script again."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "📦 Deploying to Fly.io..."
echo ""

# Deploy
fly deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your app is live at: https://$(fly status --json | grep -o '"Hostname":"[^"]*"' | cut -d'"' -f4)"
echo ""
echo "Useful commands:"
echo "  fly logs          - View logs"
echo "  fly status        - Check status"
echo "  fly secrets list  - List secrets"
echo "  fly ssh console   - SSH into machine"
