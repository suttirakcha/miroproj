import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";

export default defineSchema({
  boards: defineTable({
    title: v.string(),
    orgId: v.string(),
    authorId: v.string(),
    imageUrl: v.string(),
    favourite: v.boolean()
  })
  .index("by_org", ["orgId"])
  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["orgId"]
  })
})