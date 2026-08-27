import type { Memory, MemoryBoard } from "../models/types";
import { createArtworkDataUrl } from "../utils/art";

const now = "2026-08-16T08:00:00.000Z";

export const demoBoards: MemoryBoard[] = [
  {
    id: "personal-peggy",
    type: "personal",
    ownerId: "peggy",
    name: "Peggy's Life",
    memberIds: ["peggy"],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "our-htc-days",
    type: "shared",
    ownerId: "peggy",
    name: "Our HTC Days",
    memberIds: ["peggy", "michelle", "david"],
    createdAt: now,
    updatedAt: now,
  },
];

function memory(
  id: string,
  boardId: string,
  title: string,
  date: string,
  story: string,
  emotion: string,
  creatorId = "peggy",
): Memory {
  return {
    id,
    boardId,
    creatorId,
    contributorIds: boardId === "our-htc-days" ? [creatorId, "michelle"] : [creatorId],
    title,
    date,
    story,
    emotion,
    originalPhotoUrl: createArtworkDataUrl(`${id}:original`, "Nostalgia"),
    artworkUrl: createArtworkDataUrl(id, emotion),
    createdAt: now,
    updatedAt: now,
  };
}

export function createDemoMemories(): Memory[] {
  return [
    memory("concert", "personal-peggy", "My First Concert", "2019-06-15", "The lights rose and the whole room became a single heartbeat. I was too excited to sleep the night before.", "Excitement"),
    memory("first-htc", "personal-peggy", "My First Day at HTC", "2021-03-08", "A new badge, unfamiliar hallways, and the quiet feeling that something important had begun.", "Hope"),
    memory("beginning", "personal-peggy", "A New Beginning", "2024-09-21", "I chose the uncertain road, and it opened into colors I had never seen before.", "Nostalgia"),
    memory("today", "personal-peggy", "Today", "2026-08-16", "Building a place where the moments we love can keep glowing.", "Joy"),
    memory("shared-first", "our-htc-days", "First Day", "2021-03-08", "We arrived as strangers and left the room already laughing.", "Hope"),
    memory("team-trip", "our-htc-days", "Team Trip", "2023-11-04", "Rain on the windows, too many snacks, and stories that lasted all the way home.", "Joy", "michelle"),
    memory("hackathon", "our-htc-days", "Hackathon", "2026-08-16", "A wild idea, one shared table, and the belief that we could make memory feel alive.", "Excitement", "david"),
  ];
}
