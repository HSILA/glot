"""
Database verification script.

Connects to the database, creates tables, and shows schema.
"""
import asyncio
import sys

from sqlalchemy import text

from app.db import async_engine, init_db


async def verify_database():
    """Verify database connection and tables."""
    print("Testing database connection...")
    
    try:
        async with async_engine.connect() as conn:
            result = await conn.execute(text("SELECT version();"))
            version = result.scalar()
            print(f"Connected to: {version}\n")
    except Exception as e:
        print(f"Database connection failed: {e}")
        print("\nMake sure PostgreSQL is running:")
        print("   docker compose up -d")
        sys.exit(1)
    
    print("Creating tables...")
    try:
        await init_db()
        print("Tables created successfully\n")
    except Exception as e:
        print(f"Table creation failed: {e}")
        sys.exit(1)
    
    print("Verifying tables exist...")
    async with async_engine.connect() as conn:
        result = await conn.execute(text("""
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename;
        """))
        tables = [row[0] for row in result]
        
        if tables:
            print(f"Found {len(tables)} tables:")
            for table in tables:
                print(f"  - {table}")
            print()
        else:
            print("No tables found\n")
        
        # Show schema for each table
        for table in tables:
            print(f"Schema for '{table}':")
            result = await conn.execute(text(f"""
                SELECT 
                    column_name,
                    data_type,
                    is_nullable
                FROM information_schema.columns
                WHERE table_name = '{table}'
                ORDER BY ordinal_position;
            """))
            
            print(f"{'Column':<25} {'Type':<20} {'Nullable':<10}")
            print("-" * 60)
            for row in result:
                col_name, data_type, nullable = row
                print(f"{col_name:<25} {data_type:<20} {nullable:<10}")
            print()
    
    await async_engine.dispose()
    print("Database verification complete")


if __name__ == "__main__":
    asyncio.run(verify_database())
