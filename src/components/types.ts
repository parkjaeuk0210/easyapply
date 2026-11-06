import type { Located } from "@/lib/textmatch";

export type Source =
  | { kind: "pdf"; url: string; name: string }
  | { kind: "images"; urls: string[]; names: string[] }
  | { kind: "text"; name: string; sections: { page: number; text: string }[]; warning: string };

export type ActiveEvidence = {
  key: number;
  page: number;
  quote: string;
  items: number[];
  ranges: Located["ranges"];
  status: Located["status"];
};
