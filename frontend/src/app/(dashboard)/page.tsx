"use client";

import { Play, BookOpen, Clock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

// Mock data for demo
const recentBooks = [
  {
    id: 1,
    title: "Japanese Grammar",
    cover: "https://images.unsplash.com/photo-1528164344705-47542687000d?w=200&h=300&fit=crop",
    progress: 45,
  },
  {
    id: 2,
    title: "Medical Terms",
    cover: "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=200&h=300&fit=crop",
    progress: 72,
  },
  {
    id: 3,
    title: "Philosophy 101",
    cover: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=200&h=300&fit=crop",
    progress: 23,
  },
  {
    id: 4,
    title: "Spanish Vocab",
    cover: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&h=300&fit=crop",
    progress: 88,
  },
];

const stats = [
  { label: "Streak", value: "7 days", icon: TrendingUp },
  { label: "Today", value: "45 min", icon: Clock },
  { label: "Mastered", value: "234", icon: BookOpen },
];

export default function MyDayPage() {
  const reviewsDue = 12;
  const totalForDay = 30;
  const progressPercent = ((totalForDay - reviewsDue) / totalForDay) * 100;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Hero Section with Progress Ring */}
      <section className="flex flex-col items-center text-center pt-8 md:pt-12">
        {/* Circular Progress */}
        <div className="relative w-48 h-48 md:w-56 md:h-56 mb-6">
          <svg
            className="w-full h-full transform -rotate-90"
            viewBox="0 0 100 100"
          >
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="8"
              className="stroke-muted"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className="stroke-primary transition-all duration-700 ease-out"
              style={{
                strokeDasharray: `${2 * Math.PI * 42}`,
                strokeDashoffset: `${2 * Math.PI * 42 * (1 - progressPercent / 100)}`,
              }}
            />
          </svg>
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl md:text-5xl font-bold text-foreground">
              {reviewsDue}
            </span>
            <span className="text-sm text-muted-foreground mt-1">
              Reviews Due
            </span>
          </div>
        </div>

        {/* Greeting */}
        <h1 className="text-2xl md:text-3xl font-semibold mb-2">
          Good afternoon!
        </h1>
        <p className="text-muted-foreground mb-6">
          You&apos;re almost there. Keep up the great work!
        </p>

        {/* Start Session Button */}
        <Button
          size="lg"
          className="gap-2 h-12 px-8 text-base shadow-lg hover:shadow-xl transition-shadow"
        >
          <Play className="h-5 w-5" />
          Start Session
        </Button>
      </section>

      {/* Stats Grid */}
      <section className="grid grid-cols-3 gap-3 md:gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="text-center">
            <CardContent className="pt-6 pb-4">
              <stat.icon className="h-5 w-5 mx-auto text-primary mb-2" />
              <div className="text-xl md:text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Recent Books - Horizontal Scroll */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Books</h2>
          <Button variant="ghost" size="sm" className="text-primary">
            See all
          </Button>
        </div>
        <ScrollArea className="w-full whitespace-nowrap rounded-lg">
          <div className="flex gap-4 pb-4">
            {recentBooks.map((book) => (
              <Card
                key={book.id}
                className="w-[140px] md:w-[160px] flex-shrink-0 overflow-hidden group cursor-pointer hover:shadow-lg transition-shadow"
              >
                <div className="aspect-[2/3] relative overflow-hidden">
                  <img
                    src={book.cover}
                    alt={book.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <CardContent className="p-3">
                  <h3 className="font-serif font-medium text-sm truncate mb-2">
                    {book.title}
                  </h3>
                  <Progress value={book.progress} className="h-1.5" />
                  <span className="text-xs text-muted-foreground mt-1 block">
                    {book.progress}% complete
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </section>

      {/* Quick Actions */}
      <section className="grid grid-cols-2 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Add Book
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Import a new book to your library
            </p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              View Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Check your learning progress
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
