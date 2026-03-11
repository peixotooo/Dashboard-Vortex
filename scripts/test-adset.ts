import { createAdSet, createCampaign } from "../src/lib/meta-api";

async function main() {
  try {
    // 1. Create campaign
    console.log("Creating campaign...");
    const campaignRes = await createCampaign({
      name: "Teste LLM Agent Loop",
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: ["NONE"],
    }) as any;
    
    console.log("Campaign Response:", campaignRes);
    if (!campaignRes.id) {
       console.error("Failed to create campaign:", campaignRes);
       return;
    }

    // 2. Create ad set exactly like the LLM tries
    console.log("Creating Ad Set...");
    const adsetRes = await createAdSet({
      campaign_id: campaignRes.id,
      name: "Ad Set 01",
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      daily_budget: 5000,
    });
    
    console.log("Ad Set Response:", adsetRes);
  } catch (err) {
    console.error("Simulation failed with error:", err);
  }
}

main();
