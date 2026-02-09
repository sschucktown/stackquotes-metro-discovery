import * as cheerio from "cheerio";

export type ExtractedPage = {
  title: string;
  h1: string;
  text: string;
  links: Array<{ href: string; text: string }>;
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function extractFromHtml(html: string): ExtractedPage {
  const $ = cheerio.load(html);

  // Remove obvious noise
  $("script,noscript,style,svg,iframe").remove();

  const title = normalizeWhitespace($("title").first().text() || "");
  const h1 = normalizeWhitespace($("h1").first().text() || "");

  // Visible-ish text
  const bodyText = normalizeWhitespace($("body").text() || "");

  const links: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") ?? "").trim();
    const text = normalizeWhitespace($(el).text() || "");
    if (!href) return;
    links.push({ href, text });
  });

  return { title, h1, text: bodyText, links };
}

