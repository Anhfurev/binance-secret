"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Check,
  LogIn,
  Lock,
  Mail,
  Shield,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const BENEFITS = [
  "Sync your AI trader across devices",
  "Backup demo portfolio and settings",
  "Secure session management with Supabase",
];

function AuthPageContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const nextMode = searchParams.get("mode");
    if (nextMode === "signup" || nextMode === "signin") {
      setMode(nextMode);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      console.log("Supabase not configured");
      return;
    }
    console.log("Supabase configured");

    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      console.log("User:", data.user);
      setAuthUser(data.user ?? null);
    }).catch((error) => {
        console.error("Error getting user:", error);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Session:", session);
      setAuthUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const isFormValid = useMemo(() => {
    if (mode === "signup") {
      return (
        authEmail.trim().length > 3 &&
        authPassword.length >= 6 &&
        authPassword === authPasswordConfirm
      );
    }
    return authEmail.trim().length > 3 && authPassword.length >= 6;
  }, [authEmail, authPassword, authPasswordConfirm, mode]);

  const authHint = useMemo(() => {
    if (!authError) return null;
    const lowered = authError.toLowerCase();
    if (lowered.includes("signup") && lowered.includes("disabled")) {
      return t(
        "Enable Email sign-ups in Supabase Auth providers.",
        "Supabase Auth providers-д Email sign-ups-г асаана уу.",
      );
    }
    if (lowered.includes("email") && lowered.includes("provider")) {
      return t(
        "Enable the Email provider in Supabase Auth settings.",
        "Supabase Auth тохиргоонд Email provider-г асаана уу.",
      );
    }
    return null;
  }, [authError, t]);

  const handleEmailChange = (value: string) => {
    setAuthEmail(value);
    if (authError) setAuthError(null);
  };

  const handlePasswordChange = (value: string) => {
    setAuthPassword(value);
    if (authError) setAuthError(null);
  };

  const handlePasswordConfirmChange = (value: string) => {
    setAuthPasswordConfirm(value);
    if (authError) setAuthError(null);
  };

  const handleAuthSubmit = async (nextMode: "signin" | "signup") => {
    if (!isSupabaseConfigured || !supabase) {
      const msg = t("Supabase is not configured", "Supabase тохируулаагүй");
      setAuthError(msg);
      toast.error(msg);
      return;
    }

    if (!isFormValid) {
      let errorMsg = "";
      if (authEmail.trim().length <= 3) {
        errorMsg = t("Enter a valid email.", "Зөв email оруулна уу.");
      } else if (authPassword.length < 6) {
        errorMsg = t(
          "Password must be at least 6 characters.",
          "Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой.",
        );
      } else if (
        nextMode === "signup" &&
        authPassword !== authPasswordConfirm
      ) {
        errorMsg = t("Passwords do not match.", "Нууц үг таарахгүй байна.");
      } else {
        errorMsg = t(
          "Enter a valid email and password.",
          "Зөв email болон нууц үг оруулна уу.",
        );
      }
      setAuthError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    setAuthError(null);
    setAuthLoading(true);

    try {
        const response =
          nextMode === "signup"
            ? await supabase.auth.signUp({
                email: authEmail.trim(),
                password: authPassword,
              })
            : await supabase.auth.signInWithPassword({
                email: authEmail.trim(),
                password: authPassword,
              });

        console.log("Response:", response);

        if (response.error) {
          const errorMsg =
            typeof response.error === "object"
              ? response.error.message || JSON.stringify(response.error)
              : String(response.error);
          setAuthError(errorMsg);
          toast.error(errorMsg);
          return;
        }

        if (nextMode === "signup") {
          if (response.data?.session) {
            setAuthPassword("");
            toast.success(t("Account created", "Бүртгэл үүслээ"), {
              description: t(
                "You're signed in and ready to go.",
                "Та амжилттай нэвтэрлээ.",
              ),
            });
            router.push("/");
            return;
          }

          toast.success(t("Account created", "Бүртгэл үүслээ"), {
            description: t(
              "Check your email if confirmation is enabled, then sign in to continue.",
              "Хэрэв email баталгаажуулалт асаалттай бол email-ээ шалгаад дараа нь нэвтэрнэ үү.",
            ),
          });
          return;
        }

        setAuthPassword("");
        toast.success(t("Signed in", "Нэвтэрлээ"), {
          description: t(
            "Welcome back. Your trader will sync to this account.",
            "Тавтай морил. Таны trader энэ данс руу синк хийнэ.",
          ),
        });
        router.push("/");
    } catch (error) {
        console.error("Auth error:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        setAuthError(errorMsg);
        toast.error(errorMsg);
    } finally {
        setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    try {
        const { error } = await supabase.auth.signOut();

        if (error) {
          const errorMsg =
            typeof error === "object"
              ? error.message || JSON.stringify(error)
              : String(error);
          toast.error(errorMsg);
          return;
        }

        setAuthPassword("");
        toast.success(t("Signed out", "Гарлаа"));
    } catch (error) {
        console.error("Sign out error:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        toast.error(errorMsg);
    } finally {
        setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-bg grid-background">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-10 md:px-8">
        <div className="mb-10 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary glow-blue">
              <Shield className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                {t("Account", "Данс")}
              </p>
              <h1 className="text-3xl font-bold text-foreground md:text-4xl">
                {t("Sign in to NexTrade", "NexTrade-д нэвтрэх")}
              </h1>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              "Secure your AI trading workspace and keep signals, settings, and automation synced.",
              "AI арилжааны орчноо хамгаалж, дохио, тохиргоо, automation-г синк хийнэ.",
            )}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <Card className="border-border/60 bg-card/70 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("Why sign in?", "Яагаад нэвтрэх вэ?")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Connect your workspace to unlock secure sync and smarter automation.",
                  "Орчноо холбоод хамгаалагдсан синк, ухаалаг automation-г нээнэ.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {BENEFITS.map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 p-4"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {t(benefit, benefit)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Your data stays encrypted in your Supabase project.",
                        "Таны өгөгдөл Supabase төсөл дээр шифрлэгдэнэ.",
                      )}
                    </p>
                  </div>
                </div>
              ))}
              <Separator className="bg-border/40" />
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {t("Email + password", "Email + нууц үг")}
                </Badge>
                <Badge variant="secondary">
                  {t("No credit card", "Кредит карт шаардлагагүй")}
                </Badge>
                <Badge variant="secondary">
                  {t("Instant access", "Шуурхай нэвтрэх")}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80 backdrop-blur-md">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>{t("Access", "Нэвтрэх")}</CardTitle>
                  <CardDescription>
                    {t(
                      "Sign in or create a new account in seconds.",
                      "Хэдхэн секундэд нэвтэрч эсвэл шинэ данс үүсгэнэ.",
                    )}
                  </CardDescription>
                </div>
                <Badge variant={authUser ? "default" : "outline"}>
                  {authUser
                    ? t("Connected", "Холбогдсон")
                    : t("Device mode", "Төхөөрөмжийн горим")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {authError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  <p className="font-medium">{authError}</p>
                  {authHint && (
                    <p className="mt-2 text-xs text-destructive/80">
                      {authHint}
                    </p>
                  )}
                </div>
              )}
              {!isSupabaseConfigured ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-muted-foreground">
                  {t(
                    "Supabase environment variables are missing. Add them before using account sync.",
                    "Supabase environment variable байхгүй байна. Account sync ашиглахаас өмнө нэмнэ үү.",
                  )}
                </div>
              ) : authUser ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/50 bg-background/40 p-4">
                    <p className="text-sm text-muted-foreground">
                      {t("Signed in as", "Дараах имэйлээр нэвтэрсэн")}
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {authUser.email}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleSignOut}
                    disabled={authLoading}
                  >
                    {t("Sign Out", "Гарах")}
                  </Button>
                </div>
              ) : (
                <Tabs
                  value={mode}
                  onValueChange={(v) => setMode(v as typeof mode)}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signin">
                      <LogIn className="h-4 w-4" />
                      {t("Sign In", "Нэвтрэх")}
                    </TabsTrigger>
                    <TabsTrigger value="signup">
                      <UserPlus className="h-4 w-4" />
                      {t("Sign Up", "Бүртгүүлэх")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="signin" className="mt-6">
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleAuthSubmit("signin");
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="signin-email">
                          {t("Email", "Email")}
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="signin-email"
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            value={authEmail}
                            onChange={(event) =>
                              handleEmailChange(event.target.value)
                            }
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signin-password">
                          {t("Password", "Нууц үг")}
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="signin-password"
                            type="password"
                            placeholder="••••••••"
                            autoComplete="current-password"
                            value={authPassword}
                            onChange={(event) =>
                              handlePasswordChange(event.target.value)
                            }
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={authLoading || !isFormValid}
                      >
                        {authLoading
                          ? t("Signing in...", "Нэвтэрч байна...")
                          : t("Sign In", "Нэвтрэх")}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="signup" className="mt-6">
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleAuthSubmit("signup");
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="signup-email">
                          {t("Email", "Email")}
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="signup-email"
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            value={authEmail}
                            onChange={(event) =>
                              handleEmailChange(event.target.value)
                            }
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-password">
                          {t("Password", "Нууц үг")}
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="signup-password"
                            type="password"
                            placeholder="Minimum 6 characters"
                            autoComplete="new-password"
                            value={authPassword}
                            onChange={(event) =>
                              handlePasswordChange(event.target.value)
                            }
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-password-confirm">
                          {t("Confirm Password", "Нууц үг баталгаажуулах")}
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="signup-password-confirm"
                            type="password"
                            placeholder="Repeat password"
                            autoComplete="new-password"
                            value={authPasswordConfirm}
                            onChange={(event) =>
                              handlePasswordConfirmChange(event.target.value)
                            }
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={authLoading || !isFormValid}
                      >
                        {authLoading
                          ? t("Creating account...", "Бүртгэл үүсгэж байна...")
                          : t("Create Account", "Бүртгэл үүсгэх")}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "By creating an account, you agree to keep your keys safe and follow your project policies.",
                          "Бүртгэл үүсгэснээр та түлхүүрүүдээ аюулгүй хадгалж, төслийн дүрмийг мөрдөнө.",
                        )}
                      </p>
                    </form>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  )
}
