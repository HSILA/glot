"use client";

import { useState } from "react";
import { Search, Grid3X3, List, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Mock data
const books = [
  {
    id: 1,
    title: "Genki I: Japanese",
    author: "Eri Banno",
    cover: "https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=600&fit=crop",
    progress: 45,
    totalCards: 500,
    dueCards: 12,
    category: "Language",
  },
  {
    id: 2,
    title: "Medical Terminology",
    author: "Barbara Cohen",
    cover: "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=400&h=600&fit=crop",
    progress: 72,
    totalCards: 800,
    dueCards: 5,
    category: "Science",
  },
  {
    id: 3,
    title: "Philosophy 101",
    author: "Paul Kleinman",
    cover: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop",
    progress: 23,
    totalCards: 200,
    dueCards: 28,
    category: "Philosophy",
  },
  {
    id: 4,
    title: "Spanish Vocabulary",
    author: "Barron's",
    cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=600&fit=crop",
    progress: 88,
    totalCards: 1200,
    dueCards: 3,
    category: "Language",
  },
  {
    id: 5,
    title: "Data Structures",
    author: "Cormen et al.",
    cover: "https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400&h=600&fit=crop",
    progress: 56,
    totalCards: 350,
    dueCards: 15,
    category: "Tech",
  },
  {
    id: 6,
    title: "Art History",
    author: "H.W. Janson",
    cover: "https://images.unsplash.com/photo-1541963463532-d68292c34b19?w=400&h=600&fit=crop",
    progress: 34,
    totalCards: 450,
    dueCards: 22,
    category: "Arts",
  },
];

export default function LibraryPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBooks = books.filter((book) =>
    book.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground">
            {books.length} books in your collection
          </p>
        </div>
        <Button className="gap-2 w-full md:w-auto">
          <Plus className="h-4 w-4" />
          Add Book
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search books..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Filter & View Toggle */}
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10">
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>All Categories</DropdownMenuItem>
              <DropdownMenuItem>Language</DropdownMenuItem>
              <DropdownMenuItem>Science</DropdownMenuItem>
              <DropdownMenuItem>Tech</DropdownMenuItem>
              <DropdownMenuItem>Arts</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex rounded-lg border border-input overflow-hidden">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10 rounded-none"
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10 rounded-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Books Grid/List */}
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
          {filteredBooks.map((book) => (
            <Card
              key={book.id}
              className="overflow-hidden group cursor-pointer hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            >
              <div className="aspect-[2/3] relative overflow-hidden">
                <img
                  src={book.cover}
                  alt={book.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                  <Badge variant="secondary" className="self-start mb-2">
                    {book.dueCards} due
                  </Badge>
                </div>
              </div>
              <CardContent className="p-3">
                <h3 className="font-serif font-semibold text-sm line-clamp-1 mb-1">
                  {book.title}
                </h3>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                  {book.author}
                </p>
                <Progress value={book.progress} className="h-1.5" />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-muted-foreground">
                    {book.progress}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {book.totalCards} cards
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBooks.map((book) => (
            <Card
              key={book.id}
              className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex gap-4 p-4">
                <img
                  src={book.cover}
                  alt={book.title}
                  className="w-16 h-24 object-cover rounded-md flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-serif font-semibold line-clamp-1">
                        {book.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {book.author}
                      </p>
                    </div>
                    <Badge variant="outline">{book.category}</Badge>
                  </div>
                  <div className="mt-3">
                    <Progress value={book.progress} className="h-2" />
                    <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
                      <span>{book.progress}% complete</span>
                      <span>
                        {book.dueCards} due &middot; {book.totalCards} cards
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
