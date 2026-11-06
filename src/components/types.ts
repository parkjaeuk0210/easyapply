import type { Located } from "@/lib/textmatch";

export type Source =
  | { kind: "pdf"; url: string; name: string }
  | { kind: "images"; urls: string[]; names: string[] }
  | { kind: "text"; name: string; sections: { page: number; text: string }[]; warning: string; originalFile?: File };

export type ActiveEvidence = {
  key: number;
  /** 같은 버튼에서 나온 근거 묶음을 구별하는 값 */
  id: string;
  page: number;
  quotes: string[];
  items: number[];
  ranges: Located["ranges"];
  status: Located["status"];
};
