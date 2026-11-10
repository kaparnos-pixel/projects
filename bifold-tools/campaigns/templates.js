// Ready-made campaign designs for each company. Text in [square brackets] is for the team to replace.
// Written in each company's voice; no prices, figures or claims that would need checking before sending.
window.MK_TEMPLATES = {
  bifold: [
    {
      id: "bf-newsletter", name: "Monthly insights newsletter", note: "Awareness newsletter: three topics and an AMC spotlight",
      subject: "What IT leaders in the UAE are planning next", preheader: "Zero trust access, Teams calling and AI-ready infrastructure, in five minutes.", edition: "[Month 2026]",
      blocks: [
        { t: "hero", kicker: "Bifold Insights", title: "Building an IT estate that is ready for what comes next", text: "A short read for IT and procurement leaders across the UAE: what we are seeing in the field this month, and where it is heading.", btn: "Talk to our team", url: "https://www.bifoldtech.com" },
        { t: "text", text: "Hi {{first_name|there}},\n\nEvery month our engineers work on networks, phone systems and data centres across Dubai and the wider UAE. Here are three things worth knowing this month." },
        { t: "features", title: "In this edition", items: [
          { title: "Zero trust, without the VPN pain", text: "How Fortinet ZTNA gives remote staff secure access to just the apps they need." },
          { title: "Teams calling, no PBX", text: "Microsoft Teams Direct Routing with a Ribbon SBC and your local SIP trunk." },
          { title: "Getting AI-ready", text: "The infrastructure checks we run before any private LLM or AI pilot goes live." },
        ] },
        { t: "split", img: "", alt: "Bifold engineer carrying out preventive maintenance in a server room", side: "left", title: "Support that keeps you running", text: "Our Annual Maintenance Contracts cover networks, telephony, servers and CCTV with SLA-backed response times and scheduled preventive maintenance.", btn: "Explore AMC plans", url: "https://www.bifoldtech.com" },
        { t: "cta", title: "Planning a project this quarter?", text: "Book a 30-minute call with a Bifold solutions architect. No obligation, just practical advice.", btn: "Book a call", url: "https://www.bifoldtech.com" },
      ],
    },
    {
      id: "bf-spotlight", name: "Solution spotlight", note: "One solution, explained simply, with a clear next step",
      subject: "Secure remote access without the VPN headaches", preheader: "How UAE organisations are moving to zero trust network access.", edition: "",
      blocks: [
        { t: "hero", kicker: "Solution spotlight", title: "Secure access for every user, on any network", text: "Give staff and contractors access to exactly the applications they need, and nothing more.", btn: "See how it works", url: "https://www.bifoldtech.com" },
        { t: "text", text: "Hi {{first_name|there}},\n\nTraditional VPNs give users a door into the whole network. Zero trust network access (ZTNA) checks every user and device, every time, and connects them only to the application they asked for.\n\nWith FortiGate ZTNA, Bifold helps you:\n\n- Replace or reduce VPN dependence without disrupting users\n- Apply the same policy in the office and on the road\n- See who accessed what, from which device, and when" },
        { t: "image", img: "", alt: "Diagram of users connecting to applications through a ZTNA gateway", w: "inset", caption: "[Optional caption]" },
        { t: "heading", text: "How we deliver it" },
        { t: "features", items: [
          { title: "Assess", text: "We review your applications, users and current remote access set-up." },
          { title: "Design and deploy", text: "Our engineers configure policies, tags and the access proxy." },
          { title: "Support", text: "Ongoing support and health checks under a Bifold maintenance contract." },
        ] },
        { t: "cta", title: "Is ZTNA right for you?", text: "Reply to this email or book a short call and we will walk you through it.", btn: "Book a consultation", url: "https://www.bifoldtech.com" },
      ],
    },
    {
      id: "bf-event", name: "Event or webinar invitation", note: "Invite with date, venue and a registration button",
      subject: "You're invited: [event name]", preheader: "[Date] at [venue]. Seats are limited, register today.", edition: "Invitation",
      blocks: [
        { t: "hero", kicker: "You're invited", title: "[Event name]", text: "Join Bifold Technologies and [partner] for [a short description of the session].", btn: "Reserve your seat", url: "https://www.bifoldtech.com" },
        { t: "text", text: "Hi {{first_name|there}},\n\nWe would be delighted to see you at [event name].\n\n- **Date:** [day, date]\n- **Time:** [start] to [end] (UAE time)\n- **Venue:** [venue, area, city] or online\n\nYou will hear from our engineers and [partner] about [topic], with time for questions and a live demo." },
        { t: "button", btn: "Register now", url: "https://www.bifoldtech.com", align: "center" },
        { t: "divider" },
        { t: "text", text: "Can't make it? Reply to this email and we will send you the slides afterwards." },
      ],
    },
    {
      id: "bf-letter", name: "Simple announcement", note: "Letter-style email for news or a short update",
      subject: "[A short, clear subject]", preheader: "[One line that makes people want to open it]", edition: "",
      blocks: [
        { t: "heading", kicker: "News from Bifold", text: "[Headline for your announcement]" },
        { t: "text", text: "Hi {{first_name|there}},\n\n[Write your message here. Keep it to two or three short paragraphs.]\n\n[Explain what it means for the reader and what they can do next.]\n\nKind regards,\n**[Name]**\n[Title], Bifold Technologies" },
        { t: "button", btn: "Learn more", url: "https://www.bifoldtech.com", align: "left" },
      ],
    },
  ],
  techhub: [
    {
      id: "th-newsletter", name: "Tech Hub update", note: "Friendly monthly update for RAK customers and businesses",
      subject: "What's new at Tech Hub this month", preheader: "New arrivals, business IT tips and what we're up to in RAK.", edition: "[Month 2026]",
      blocks: [
        { t: "hero", kicker: "Tech Hub RAK", title: "Your local technology partner in Ras Al Khaimah", text: "From the latest laptops and gaming gear to complete office IT, it's all under one roof in Al Nakheel.", btn: "Visit us", url: "https://www.techhubrak.ae" },
        { t: "text", text: "Hi {{first_name|there}},\n\nHere's a quick look at what's happening at Tech Hub this month." },
        { t: "split", img: "", alt: "New laptops on display in the Tech Hub showroom", side: "left", title: "New in store", text: "[Describe the new arrivals: brands, product types and who they suit.]", btn: "See what's new", url: "https://www.techhubrak.ae" },
        { t: "split", img: "", alt: "Tech Hub engineer setting up an office network", side: "right", title: "IT for RAK businesses", text: "Office set-up, Wi-Fi, CCTV, Microsoft 365 and support contracts, handled by our local team.", btn: "Talk to our team", url: "https://www.techhubrak.ae" },
        { t: "features", title: "Why customers choose Tech Hub", items: [
          { title: "Local and close", text: "A showroom and support team right here in Al Nakheel." },
          { title: "Retail and business", text: "One partner for your home tech and your office IT." },
          { title: "Advice that fits", text: "Honest recommendations for your needs and budget." },
        ] },
        { t: "cta", title: "Need something specific?", text: "Message us on WhatsApp or drop by the store. We're happy to help.", btn: "Chat on WhatsApp", url: "https://wa.me/97172581926" },
      ],
    },
    {
      id: "th-offer", name: "In-store spotlight", note: "Feature a product range or offer (add your own details)",
      subject: "[Product range] now at Tech Hub RAK", preheader: "[One line about the range or offer]", edition: "",
      blocks: [
        { t: "image", img: "", alt: "[Product photo]", w: "full" },
        { t: "hero", kicker: "In store now", title: "[Product range or offer headline]", text: "[One or two sentences on what's special about it.]", btn: "Shop now", url: "https://www.techhubrak.ae", align: "center" },
        { t: "text", text: "Hi {{first_name|there}},\n\n[Explain the range or offer.]\n\n- [Highlight one]\n- [Highlight two]\n- [Highlight three]\n\n[Offer terms, if any: dates, stock, conditions.]" },
        { t: "button", btn: "Visit Tech Hub", url: "https://www.techhubrak.ae", align: "center" },
      ],
    },
    {
      id: "th-business", name: "Business IT services", note: "For SMEs, schools and hospitality in RAK",
      subject: "Office IT, sorted, by your local RAK team", preheader: "Set-up, networking, CCTV and support contracts from Tech Hub.", edition: "For business",
      blocks: [
        { t: "hero", kicker: "Tech Hub for Business", title: "IT that just works, so your team can too", text: "Tech Hub helps RAK businesses, schools and hotels plan, set up and look after their technology.", btn: "Book a free visit", url: "https://www.techhubrak.ae" },
        { t: "text", text: "Hi {{first_name|there}},\n\nWhether you're opening a new office or tidying up an old set-up, our engineers can help with:" },
        { t: "features", items: [
          { title: "Set-up and networking", text: "PCs, printers, Wi-Fi and structured cabling for your premises." },
          { title: "CCTV and security", text: "Cameras, recorders and remote viewing, installed and maintained." },
          { title: "Support contracts", text: "Annual maintenance with planned visits and fast response." },
        ] },
        { t: "cta", title: "Let's talk about your office", text: "We'll visit, take a look and recommend what you actually need.", btn: "Book a visit", url: "https://www.techhubrak.ae" },
      ],
    },
    {
      id: "th-letter", name: "Simple message", note: "A short, personal note from the team",
      subject: "[A short, clear subject]", preheader: "[One line that makes people want to open it]", edition: "",
      blocks: [
        { t: "heading", kicker: "From the Tech Hub team", text: "[Headline]" },
        { t: "text", text: "Hi {{first_name|there}},\n\n[Write your message here.]\n\nSee you soon,\n**[Name]**\nTech Hub Information Technology, RAK" },
        { t: "button", btn: "Visit our website", url: "https://www.techhubrak.ae", align: "left" },
      ],
    },
  ],
};
