"use client";

import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  HelpCircle,
  Target,
  Wallet,
  Sparkles,
  Fish,
  ChartLine,
  Shield,
  MessageSquare,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";

const features = [
  {
    icon: Target,
    title: "AI Trade Signals",
    description:
      "Clear BUY/SELL/HOLD recommendations with entry points, stop-loss levels, and take-profit targets.",
    link: "/signals",
  },
  {
    icon: Wallet,
    title: "Demo Account",
    description:
      "Test AI signals with $100,000 virtual money. Track your performance over 30 days risk-free.",
    link: "/demo",
  },
  {
    icon: Sparkles,
    title: "Portfolio Optimizer",
    description:
      "AI-powered portfolio analysis with rebalancing recommendations to improve risk-adjusted returns.",
    link: "/optimizer",
  },
  {
    icon: Fish,
    title: "Whale Tracker",
    description:
      "Monitor large crypto transactions. Understand whale behavior and potential market impact.",
    link: "/whale",
  },
  {
    icon: ChartLine,
    title: "Price Predictions",
    description:
      "Machine learning models predict prices across multiple timeframes with confidence scores.",
    link: "/predictions",
  },
  {
    icon: MessageSquare,
    title: "AI Assistant",
    description:
      "Ask questions about your portfolio, market conditions, or get trading insights in natural language.",
    link: "/",
  },
];

const faqs = [
  {
    question: "How accurate are the AI predictions?",
    answer:
      "Our AI models have shown 65-75% accuracy on directional predictions over backtesting periods. However, past performance does not guarantee future results. Always use predictions as one input among many in your decision-making process.",
  },
  {
    question: "Is this financial advice?",
    answer:
      "No. NexTrade is a personal analysis tool for educational purposes only. Nothing on this platform constitutes financial, investment, or trading advice. Always do your own research and consult with a qualified financial advisor.",
  },
  {
    question: "How does the demo account work?",
    answer:
      "The demo account starts with $100,000 in virtual funds. You can follow AI signals to place virtual trades and track performance over 30 days. No real money is involved. It's a risk-free way to test our AI before making real decisions.",
  },
  {
    question: "What data sources does NexTrade use?",
    answer:
      "We aggregate data from CoinGecko (prices, market caps), Alternative.me (Fear & Greed Index), on-chain analytics providers, and social sentiment APIs. All data is processed through our AI models to generate insights.",
  },
  {
    question: "How often are signals updated?",
    answer:
      "Market data refreshes every 60 seconds. AI signals are recalculated every 15 minutes or when significant market events occur. Price predictions are updated hourly.",
  },
  {
    question: "Can I connect my real exchange?",
    answer:
      "Yes — you can configure your Binance API keys in Settings for read-only portfolio monitoring. Automated live trading is not yet supported; all trade execution happens in the Demo Lab paper trading environment. Never share API keys with withdrawal permissions.",
  },
  {
    question: "What cryptocurrencies are supported?",
    answer:
      "We currently track the top cryptocurrencies by market cap: BTC, ETH, SOL, XRP, BNB, and DOGE. More coins may be added in future updates.",
  },
  {
    question: "How is my data protected?",
    answer:
      "NexTrade runs entirely in your browser. We do not store any personal portfolio data on our servers. Demo account data is stored locally and can be reset at any time.",
  },
];

export default function HelpPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const tr = (en: string, mn: string) => t(en, mn);

  return (
    <AppLayout showChatbot={false}>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
            <HelpCircle className="h-7 w-7 text-primary" />
            {t("Help & Guide", "Тусламж ба заавар")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {t(
              "Learn how to use NexTrade effectively",
              "NexTrade-г үр дүнтэй ашиглах арга",
            )}
          </p>
        </div>

        {/* Features Overview */}
        <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              {t("Platform Features", "Платформын боломжууд")}
            </CardTitle>
            <CardDescription>
              {t(
                "Everything you need to analyze crypto markets",
                "Крипто захыг шинжлэхэд хэрэгтэй бүх зүйл",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <Card
                    key={feature.title}
                    className="card-hover border-border/50"
                  >
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground">
                            {feature.title}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {tr(
                              feature.description,
                              feature.title === "AI Trade Signals"
                                ? "Оролт, stop-loss, take-profit түвшинтэй BUY/SELL/HOLD тодорхой зөвлөмж."
                                : feature.title === "Demo Account"
                                  ? "$100,000 виртуал мөнгөөр AI дохио турш. 30 хоногийн үр дүнгээ хянах боломжтой."
                                  : feature.title === "Portfolio Optimizer"
                                    ? "Эрсдэлд тохируулсан өгөөж сайжруулах дахин тэнцвэржүүлэх AI зөвлөмж."
                                    : feature.title === "Whale Tracker"
                                      ? "Том гүйлгээг хянаж, whale зан төлөв болон захын нөлөөг ойлгоно."
                                      : feature.title === "Price Predictions"
                                        ? "Олон хугацааны үнийн таамгийг итгэлцлийн оноотой харуулна."
                                        : "Портфель, захын нөхцөл болон арилжааны асуултад AI туслах хариулна.",
                            )}
                          </p>
                          <Button
                            variant="link"
                            className="mt-2 h-auto p-0 text-primary"
                            onClick={() => router.push(feature.link)}
                          >
                            {t("Learn more", "Дэлгэрэнгүй")}
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card className="mb-8 border-border/50 bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              {t("Frequently Asked Questions", "Түгээмэл асуултууд")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq, idx) => (
                <AccordionItem
                  key={idx}
                  value={`item-${idx}`}
                  className="border-border/50"
                >
                  <AccordionTrigger className="text-left hover:text-primary">
                    {tr(
                      faq.question,
                      faq.question === "How accurate are the AI predictions?"
                        ? "AI таамаглал хэр нарийвчлалтай вэ?"
                        : faq.question === "Is this financial advice?"
                          ? "Энэ санхүүгийн зөвлөгөө мөн үү?"
                          : faq.question === "How does the demo account work?"
                            ? "Демо данс яаж ажилладаг вэ?"
                            : faq.question ===
                                "What data sources does NexTrade use?"
                              ? "NexTrade ямар өгөгдлийн эх сурвалж ашигладаг вэ?"
                              : faq.question ===
                                  "How often are signals updated?"
                                ? "Дохио хэр ойрхон шинэчлэгддэг вэ?"
                                : faq.question ===
                                    "Can I connect my real exchange?"
                                  ? "Бодит exchange-ээ холбож болох уу?"
                                  : faq.question ===
                                      "What cryptocurrencies are supported?"
                                    ? "Ямар криптовалют дэмждэг вэ?"
                                    : "Миний өгөгдөл хэрхэн хамгаалагддаг вэ?",
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {tr(
                      faq.answer,
                      faq.question === "How accurate are the AI predictions?"
                        ? "Манай AI загварууд чиглэлийн таамаг дээр backtesting хугацаанд 65-75% нарийвчлал үзүүлсэн. Гэхдээ өнгөрсөн үр дүн нь ирээдүйг батлахгүй. Таамгийг зөвхөн нэг оролт гэж үзэж шийдвэр гаргаарай."
                        : faq.question === "Is this financial advice?"
                          ? "Үгүй. NexTrade нь зөвхөн сургалт, анализын хувийн хэрэгсэл. Эндх мэдээлэл нь санхүү, хөрөнгө оруулалт, арилжааны зөвлөгөө биш."
                          : faq.question === "How does the demo account work?"
                            ? "Демо данс $100,000 виртуал хөрөнгөөр эхэлнэ. AI дохиогоор виртуал арилжаа хийж 30 хоногийн гүйцэтгэлээ хянах боломжтой. Бодит мөнгө оролцохгүй."
                            : faq.question ===
                                "What data sources does NexTrade use?"
                              ? "CoinGecko (үнэ, cap), Alternative.me (Fear & Greed), on-chain эх сурвалж, social sentiment API-уудаас өгөгдөл нэгтгэдэг."
                              : faq.question ===
                                  "How often are signals updated?"
                                ? "Захын өгөгдөл 60 секунд тутам шинэчлэгдэнэ. AI дохио 15 минут тутам эсвэл томоохон үйл явдалд дахин тооцогдоно."
                                : faq.question ===
                                    "Can I connect my real exchange?"
                                  ? "Тийм — Тохиргоо хэсэгт Binance API түлхүүрээ оруулж зөвхөн-унших горимоор портфелиа хянах боломжтой. Автомат live арилжаа одоогоор дэмжигдэхгүй, бүх арилжаа Demo Lab-д цаасан дээр хийгдэнэ. Withdraw зөвшөөрөлтэй API түлхүүр хэзээ ч бүү хуваалцаарай."
                                  : faq.question ===
                                      "What cryptocurrencies are supported?"
                                    ? "Одоогоор BTC, ETH, SOL, XRP, BNB, DOGE зэрэг том cap coin-уудыг дэмжинэ."
                                    : "NexTrade нь таны хөтөч дээр ажилладаг. Хувийн портфелийн өгөгдлийг серверт хадгалдаггүй бөгөөд хүссэн үедээ reset хийж болно.",
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <Shield className="mt-0.5 h-6 w-6 shrink-0 text-warning" />
              <div>
                <h3 className="font-bold text-foreground">
                  {t("Risk Disclaimer", "Эрсдэлийн анхааруулга")}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {tr(
                    "Cryptocurrency trading carries significant risks. The information provided by NexTrade is for educational and informational purposes only and should not be considered as financial advice. AI predictions and signals are based on historical data and may not accurately predict future market movements. You should never invest money you cannot afford to lose. Always conduct your own research and consult with a qualified financial advisor before making any investment decisions.",
                    "Криптовалютын арилжаа өндөр эрсдэлтэй. NexTrade-ийн өгсөн мэдээлэл нь зөвхөн сургалт, мэдээллийн зориулалттай бөгөөд санхүүгийн зөвлөгөө биш. AI таамаглал, дохио нь түүхэн өгөгдөл дээр тулгуурладаг тул ирээдүйн захын хөдөлгөөнийг яг таг таамаглахгүй байж болно. Алдаж болохгүй мөнгөө бүү хөрөнгө оруул. Шийдвэр гаргахаасаа өмнө өөрийн судалгааг хийж, шаардлагатай бол мэргэжлийн зөвлөхтөй зөвлөлд.",
                  )}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t("Not Financial Advice", "Санхүүгийн зөвлөгөө биш")}
                  </Badge>
                  <Badge variant="outline">
                    {t("Educational Only", "Сургалтын зориулалттай")}
                  </Badge>
                  <Badge variant="outline">
                    {t("Personal Use", "Хувийн хэрэглээ")}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
