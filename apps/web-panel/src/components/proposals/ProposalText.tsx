import type { ReactNode } from "react";

/**
 * نمایش متن پروپوزال: خطی که با «# » شروع شود عنوان بخش است، خط خالی پاراگراف را جدا می‌کند و خطی که با «- » شروع شود
 * آیتم فهرست است. تمام متن به‌صورت «متن» رندر می‌شود (React escape می‌کند)، هرگز HTML خام نیست.
 */
export function ProposalText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="text-[13.5px] leading-8 whitespace-pre-wrap">{para.join("\n")}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc pr-5 text-[13.5px] leading-8">
          {list.map((li, i) => (
            <li key={i}>{li}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push(
        <h3 key={`h${blocks.length}`} className="text-[15px] font-extrabold mt-3 text-ink">
          {line.replace(/^#{1,3}\s+/, "")}
        </h3>,
      );
    } else if (/^[-•]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-•]\s+/, ""));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="flex flex-col gap-2">{blocks}</div>;
}
