#!/bin/bash
set -e

echo "================================"
echo "Mattermost Production Deployment"
echo "================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    
    # Generate random password
    RANDOM_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    
    # Update password in .env
    if command -v sed &> /dev/null; then
        sed -i "s/change_this_secure_password_123/${RANDOM_PASSWORD}/" .env
        echo "✓ Generated random database password"
    fi
    
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file and configure:"
    echo "   - MM_SITEURL (your domain or IP)"
    echo "   - Email settings (optional, for notifications)"
    echo ""
    read -p "Press Enter to continue or Ctrl+C to abort and edit .env first..."
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/engine/install/"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose is not installed or outdated."
    echo "   Please install Docker Compose V2"
    exit 1
fi

echo "✓ Docker and Docker Compose are available"
echo ""

# Validate configuration
echo "Validating Docker Compose configuration..."
if docker compose -f docker-compose.prod.yml config > /dev/null 2>&1; then
    echo "✓ Configuration is valid"
else
    echo "❌ Configuration validation failed"
    exit 1
fi

echo ""
echo "Starting deployment..."
echo ""

# Build and start services
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "================================"
echo "Deployment Complete!"
echo "================================"
echo ""
echo "📊 Service Status:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo "📝 Logs:"
echo "   View all logs:  docker compose -f docker-compose.prod.yml logs -f"
echo "   Mattermost only: docker compose -f docker-compose.prod.yml logs -f mattermost"
echo ""
echo "🌐 Access Mattermost:"
MM_SITEURL=$(grep "^MM_SITEURL=" .env 2>/dev/null | cut -d'=' -f2 || echo "http://localhost:8065")
echo "   URL: ${MM_SITEURL}"
echo ""
echo "⚙️  Next Steps:"
echo "   1. Wait 1-2 minutes for services to start"
echo "   2. Open ${MM_SITEURL} in your browser"
echo "   3. Create your admin account"
echo "   4. Complete the setup wizard"
echo ""
echo "📚 Documentation: See PRODUCTION_DEPLOY.md for full guide"
echo ""

# Optional: Wait and show logs
read -p "Show live logs? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Showing logs (Ctrl+C to exit)..."
    docker compose -f docker-compose.prod.yml logs -f
fi
