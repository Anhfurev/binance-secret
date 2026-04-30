"use client";

import {
  Bell,
  BriefcaseBusiness,
  Building2,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleCheckBig,
  Globe,
  GraduationCap,
  Info,
  Lock,
  Plus,
  Settings,
  ShieldCheck,
  Star,
  User,
} from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCard = {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "default";
};

type OrgRow = {
  name: string;
  role: string;
  projects: string;
  pending: string;
  icon: React.ComponentType<{ className?: string }>;
};

const stats: StatCard[] = [
  { title: "Completion", value: "92%", sub: "Excellent", icon: CircleCheckBig, tone: "success" },
  { title: "Checklist", value: "356", sub: "Нийт task", icon: CheckCircle2 },
  { title: "Rating", value: "4.8", sub: "56 үнэлгээ", icon: Star },
  { title: "Projects", value: "15", sub: "Идэвхтэй", icon: BriefcaseBusiness },
];

const organizations: OrgRow[] = [
  { name: "BuildPro LLC", role: "Инженер", projects: "3 төсөл", pending: "12 pending", icon: Building2 },
  { name: "GreenBuild LLC", role: "Захирал", projects: "5 төсөл", pending: "8 pending", icon: ShieldCheck },
  { name: "EduBuild Academy", role: "Зөвлөх", projects: "3 төсөл", pending: "0 pending", icon: GraduationCap },
];

const settingsRows = [
  { icon: Bell, label: "Мэдэгдлийн тохиргоо", suffix: "" },
  { icon: Lock, label: "Нууцлал, аюулгүй байдал", suffix: "" },
  { icon: Globe, label: "Хэлний тохиргоо", suffix: "Монгол" },
  { icon: User, label: "Тусламж, дэмжлэг", suffix: "" },
  { icon: Info, label: "Хувилбар", suffix: "1.2.0" },
];

export default function ProfilePage() {
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-24 lg:px-8 lg:pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Профайл</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <Card className="mb-4 border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="relative">
                <Avatar className="h-16 w-16 border">
                  <AvatarFallback className="bg-primary/10 text-primary">MA</AvatarFallback>
                </Avatar>
                <button className="absolute -bottom-1 -right-1 rounded-full border bg-background p-1">
                  <Camera className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">М. Амарбаясгалан</h2>
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                </div>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  <span>CHONO Verified</span>
                </div>
                <Badge variant="secondary">Инженер</Badge>
                <Button variant="ghost" className="mt-2 h-auto px-0 text-primary">
                  Хувийн мэдээлэл
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="my-3 h-px bg-border/70" />

            <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Идэвхтэй компани</p>
                  <p className="text-sm font-semibold">BuildPro LLC</p>
                  <p className="text-xs text-success">Идэвхтэй</p>
                </div>
              </div>
              <Button variant="ghost" size="icon">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">МИНИЙ ҮЗҮҮЛЭЛТҮҮД</h3>
            <Button variant="ghost" className="h-auto p-0 text-primary">
              Бүгдийг харах
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="border-border/60">
                  <CardContent className="p-3">
                    <Icon className="mb-2 h-5 w-5 text-primary" />
                    <p className="text-2xl font-bold leading-none">{item.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.title}</p>
                    <Badge
                      variant="secondary"
                      className={cn("mt-2 text-[10px]", item.tone === "success" && "text-success")}
                    >
                      {item.sub}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">МИНИЙ БАЙГУУЛЛАГУУД</h3>
            <Button variant="ghost" className="h-auto p-0 text-primary">
              Бүгдийг харах
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          <Card className="border-border/60">
            <CardContent className="p-2">
              {organizations.map((org) => {
                const Icon = org.icon;
                return (
                  <div key={org.name} className="flex items-center justify-between rounded-lg p-2 hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.role}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs">{org.projects}</p>
                      <p className={cn("text-xs", org.pending.startsWith("0") ? "text-muted-foreground" : "text-destructive")}>
                        {org.pending}
                      </p>
                    </div>
                  </div>
                );
              })}
              <Button className="mt-1 w-full">
                <Plus className="mr-2 h-4 w-4" />
                Байгууллага нэмэх
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">ТОХИРГОО</h3>
          <Card className="border-border/60">
            <CardContent className="p-2">
              {settingsRows.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {item.suffix ? <span>{item.suffix}</span> : null}
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </section>

        <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10">
          Гарах
        </Button>
      </div>
    </AppLayout>
  );
}
