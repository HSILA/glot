# Adminer Database UI

## Access

**URL:** http://localhost:8080

**Login:**
- System: PostgreSQL
- Server: `postgres` (container name)
- Username: `postgres`
- Password: `postgres`
- Database: `glot`

## What You Can Do

- **Browse tables** - See all tables (cards, decks, review_logs, app_settings)
- **View data** - Click any table to see rows
- **Run SQL** - SQL command tool for custom queries
- **Export/Import** - Export to SQL, CSV, JSON
- **Edit data** - Modify rows directly
- **Create/Drop** - Manage tables (be careful!)

## Quick Actions

### View All Cards
1. Click "Select data" on `cards` table
2. See all your flashcards

### Run Custom Query
1. Click "SQL command" in the left menu
2. Example: `SELECT * FROM cards WHERE state = 'new';`

### Check Review History
1. Click on `review_logs` table
2. See all reviews with ratings

## Tips

- Adminer auto-saves your server info
- Use foreign key links to navigate between tables
- Click column headers to sort
- Use "Search data" for filtering

## Alternative: pgAdmin

If you need more features (query plans, monitoring, etc.), you can swap Adminer with pgAdmin. See docker-compose.yml comments.
