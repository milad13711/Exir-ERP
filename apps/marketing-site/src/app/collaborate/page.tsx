import type { Metadata } from "next";
import { CollaborateClient } from "./CollaborateClient";
import { BRAND } from "@/lib/content";

export const metadata: Metadata = {
  title: "همکاری با ما | نمایندگی فروش اکسیر",
  description: `به شبکه‌ی نمایندگان ${BRAND.name} بپیوندید و از معرفی هر مشتری جدید کمیسیون بگیرید — درخواست نمایندگی خودتان را همین حالا ثبت کنید.`,
  alternates: { canonical: "/collaborate" },
};

export default function CollaboratePage() {
  return <CollaborateClient />;
}
