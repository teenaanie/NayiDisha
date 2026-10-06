# Generates content/scenarios/EDU_DISCOVERY_001/source.json (v3, v4) from the owner's
# "Simulation Prototype" (see PROVENANCE.md). Edit here, then run:
#   python3 scripts/roleplay/build-edu-v3.py content/scenarios/EDU_DISCOVERY_001/source.json
# and bump scenario.version: published versions are immutable.
import json, sys
SRC = "SP"  # owner's "Simulation Prototype" document
EXCL = ["Negated assertion", "Quoted claim attributed to another person", "Question without affirmative assertion", "Appropriate response to an explicit customer request"]

def fact(id, type, value, rel, vis="on_intent", ref=SRC, knowledge="known"):
    return {"id": id, "type": type, "value": value, "knowledge": knowledge, "visibility": vis, "release_intents": rel, "prerequisite_fact_ids": [], "source_ref": ref}

facts = [
 fact("cue_soon", "text", "needs the money quite soon", [], vis="opening"),
 fact("purpose", "text", "for his daughter's college admission fees", ["loan_purpose"]),
 fact("student_details", "text", "his daughter Priya has got admission for B.Com at a college in Pune", ["student_details"], ref="recommendation"),
 fact("loan_amount", "money", {"amount_minor": 40000000, "currency": "INR"}, ["loan_amount"]),
 fact("total_cost", "money", {"amount_minor": 45000000, "currency": "INR"}, ["cost_breakup"], ref="owner decision 6 Oct 2026"),
 fact("cost_breakup", "text", "tuition and admission about ₹3 lakh, hostel and food about ₹1.2 lakh, books and other costs about ₹30,000", ["cost_breakup"], ref="owner decision 6 Oct 2026"),
 fact("own_contribution", "money", {"amount_minor": 5000000, "currency": "INR"}, ["own_contribution"], ref="owner decision 6 Oct 2026"),
 fact("course_start", "text", "classes start in about a month", ["course_start"], ref="owner decision 6 Oct 2026"),
 fact("needed_by", "relative_deadline", {"amount": 30, "unit": "days", "relative_to": "scenario_start"}, ["timing"]),
 fact("employment", "text", "salaried employee", ["employment"]),
 fact("employment_duration", "text", "has worked at the same company for about 8 years", ["employment_duration"], ref="recommendation"),
 fact("monthly_income", "money", {"amount_minor": 5500000, "currency": "INR"}, ["income"]),
 fact("cue_other_emi", "text", "already has another EMI", ["income"]),
 fact("existing_emi", "money", {"amount_minor": 800000, "currency": "INR"}, ["existing_commitments"]),
 fact("cue_low_emi", "text", "does not want a very high EMI", ["loan_amount", "premature_pitch"]),
 fact("comfortable_emi", "text", "around ₹10,000 to ₹12,000 a month more would be comfortable", ["repayment_comfort"]),
 fact("previous_loan", "text", "has taken a vehicle loan before", ["prior_borrowing", "existing_commitments"]),
 fact("cue_extra_charges", "text", "his previous loan had extra charges", ["prior_borrowing"]),
 fact("concern_charges", "text", "last time he was surprised by some additional charges; worried about hidden charges", ["concerns"]),
 fact("priority_main", "text", "an affordable monthly repayment", ["priorities"]),
 fact("priority_secondary", "text", "quick processing", ["priorities"]),
 fact("preferred_tenure", "text", "has not decided the tenure; whatever keeps the EMI comfortable", ["preferred_tenure"], ref="recommendation"),
]

NEG = ["Customer volunteers this information.", "Learner merely mentions the topic without asking or checking."]
def intent(id, desc, ex, neg=()): return {"id": id, "description": desc, "positive_examples": ex, "negative_examples": NEG + list(neg)}
intents = [
 intent("loan_purpose", "Asks why the customer needs the money, including open questions about the customer's need or situation.", ["What do you need the loan for?", "What is the purpose of the loan?", "Why do you need the money?", "What will you use this money for?", "Could you tell me more about your requirement?", "May I know about your needs and your situation?", "What brings you here today?"]),
 intent("cost_breakup", "Asks what the amount covers: the total cost and its breakup (tuition, hostel, food, other expenses).", ["Can you give me the breakup of the ₹4 lakh?", "Is it only for tuition or for other expenses too?", "Does it include hostel and food?", "What is the total cost of the course?", "How much is the college fee?", "What does the amount cover?"],
  ["How much can you pay from your side?"]),
 intent("own_contribution", "Asks how much the customer will pay from own savings or funds.", ["How much can you pay from your side?", "Will you put in any money yourself?", "Do you have any savings for this?", "How much are you contributing yourself?", "How much are you willing to pay from your own pocket?"],
  ["How much can you pay every month?", "What EMI can you manage each month?"]),
 intent("course_start", "Asks when the course or academic year starts.", ["When does the academic year start?", "When do classes begin?", "When does the course start?"]),
 intent("student_details", "Asks about the student: the daughter's name, college or course.", ["What is your daughter's name?", "Which college has she got admission in?", "Which course is she joining?", "Where will she be studying?"]),
 intent("loan_amount", "Asks how much the customer needs.", ["How much loan do you need?", "What amount are you looking for?", "How much money do you require?", "Roughly how much do you need?", "How much do you need?"]),
 intent("timing", "Asks when the funds are required (not when the customer can provide documents or details).", ["When exactly do you need the money?", "By what date do you need the funds?", "How soon do you need it?", "When do the fees have to be paid?"],
  ["How soon can you arrange those?", "When can you bring the documents?", "How soon can you share the admission details?",
   "ये डॉक्यूमेंट्स आप कब तक अरेंज कर सकते हैं?", "ती कागदपत्रं तुम्ही कधीपर्यंत आणू शकाल?"]),
 intent("employment", "Asks about the customer's work or source of income.", ["What do you do for a living?", "Are you salaried or self-employed?", "Where does your income come from?", "What is your occupation?"]),
 intent("employment_duration", "Asks how long the customer has been working in the current job or company.", ["How long have you been working in this company?", "How many years have you been in this job?", "Since when are you working there?", "How long have you been with your employer?"],
  ["How long do you need the loan for?", "Over how many years would you like to repay?"]),
 intent("income", "Asks about the customer's income or cash flow.", ["What is your monthly income?", "How much do you earn every month?", "What is your take-home salary?", "Roughly what is your income?"]),
 intent("existing_commitments", "Asks about existing EMIs or financial obligations.", ["Do you have any other EMIs?", "How much is your current EMI?", "Are you repaying any other loan right now?", "What other monthly commitments do you have?", "You mentioned another EMI. How much do you pay for it each month?", "How much do you pay every month for that loan?"],
  ["Will you be able to manage both loans?", "Can you repay this new loan along with the current one?"]),
 intent("repayment_comfort", "Asks what monthly repayment would be comfortable.", ["What's a comfortable EMI for you?", "How much could you comfortably repay every month?", "What monthly payment would work for your budget?", "What EMI can you manage each month?", "Will you be able to manage this EMI along with your current one?", "Can you afford both loans together?"],
  ["How much can you pay from your side?", "How much will you contribute from your savings?"]),
 intent("preferred_tenure", "Asks how long the customer wants to repay over.", ["Over how many years would you like to repay?", "What loan tenure do you prefer?", "How long would you like the repayment period to be?", "Do you have a repayment period in mind?"]),
 intent("prior_borrowing", "Asks about previous loan experience.", ["Have you taken a loan before?", "Do you have any previous loan experience?", "Have you borrowed from a bank earlier?", "How was your experience with your last loan?"]),
 intent("priorities", "Asks what matters most to the customer in a loan.", ["What matters most to you in this loan?", "What is most important for you: EMI, interest or speed?", "What are you looking for in a loan?", "What would make a loan right for you?"]),
 intent("concerns", "Asks about the customer's worries or what happened before.", ["Do you have any concerns about taking a loan?", "What happened with those charges?", "Is anything worrying you about the loan?", "What would you like to avoid this time?"]),
 intent("premature_pitch", "Detect a premature product recommendation, conditioned on discovery state.", ["You should take this loan now and submit documents.", "Our loan is the best option for you.", "You should apply for our loan right away.", "We offer a great loan at a low interest rate, apply today."]),
]

def rule(id, intents_, reveal, text=None, pr=100):
    r = {"id": id, "priority": pr, "intent_ids": intents_, "match": "any", "reveal_fact_ids": reveal}
    if text: r["response_text"] = text
    return r
rules = [
 rule("respond_loan_purpose", ["loan_purpose"], ["purpose"], "It is for my daughter's college admission. Her fees have to be paid."),
 rule("respond_loan_amount", ["loan_amount"], ["loan_amount"], "I need about ₹4 lakh."),
 rule("respond_cost_breakup", ["cost_breakup"], ["total_cost", "cost_breakup"], "The first year comes to about ₹4.5 lakh: around ₹3 lakh for tuition and admission, about ₹1.2 lakh for hostel and food, and about ₹30,000 for books and other costs."),
 rule("respond_own_contribution", ["own_contribution"], ["own_contribution"], "I can put in about ₹50,000 from my savings. For the rest, about ₹4 lakh, I need the loan."),
 rule("respond_course_start", ["course_start"], ["course_start"], "Classes start in about a month. That is why the fees have to be paid within 30 days."),
 rule("respond_student_details", ["student_details"], ["student_details"], "Her name is Priya. She has got admission for B.Com at a college in Pune."),
 rule("respond_timing", ["timing"], ["needed_by"], "Within 30 days. The fees have to be paid by then."),
 rule("respond_employment", ["employment"], ["employment"], "I am a salaried employee."),
 rule("respond_employment_duration", ["employment_duration"], ["employment_duration"], "I have been with the same company for about 8 years."),
 rule("respond_income", ["income"], ["monthly_income"], "I earn about ₹55,000 a month."),
 rule("respond_existing_commitments", ["existing_commitments"], ["existing_emi", "previous_loan"], "Yes, I pay ₹8,000 a month for my vehicle loan."),
 rule("respond_repayment_comfort", ["repayment_comfort"], ["comfortable_emi"], "Around ₹10,000 to ₹12,000 a month more would be comfortable."),
 rule("respond_preferred_tenure", ["preferred_tenure"], ["preferred_tenure"], "I haven't decided. Whatever keeps the EMI comfortable."),
 rule("respond_prior_borrowing", ["prior_borrowing"], ["previous_loan"], "Yes, I took a vehicle loan before."),
 rule("respond_priorities", ["priorities"], ["priority_main", "priority_secondary"], "Most important for me is an EMI I can manage every month. Quick processing would also help."),
 rule("respond_concerns", ["concerns"], ["concern_charges"], "Last time I was surprised by some additional charges. I don't want any hidden charges this time."),
 rule("respond_premature_pitch", ["premature_pitch"], ["cue_low_emi"], "Before that, I want to be sure the EMI will be manageable for me."),
]

def chk(id, desc, cat="coverage", method="semantic", intents_=None, credit="learner_question", exp=None):
    return {"id": id, "description": desc, "category": cat, "method": method, "accepted_intents": intents_ if intents_ is not None else ([id] if cat == "coverage" else []), "credit_requires": credit, "expected_fact_ids": exp or []}
cov = [
 chk("loan_purpose", "Asks why the customer needs the money", exp=["purpose"]),
 chk("loan_amount", "Asks the approximate amount required", exp=["loan_amount"]),
 chk("cost_breakup", "Explores what the amount covers: total cost and its breakup (tuition, hostel, other expenses)", exp=["total_cost", "cost_breakup"]),
 chk("own_contribution", "Asks how much the customer will contribute from own funds", exp=["own_contribution"]),
 chk("timing", "Asks when the funds are required", exp=["needed_by"]),
 chk("income", "Asks the customer's approximate income or cash flow", exp=["monthly_income"]),
 chk("existing_commitments", "Asks about existing EMIs or important financial obligations", exp=["existing_emi"]),
 chk("repayment_comfort", "Asks what monthly repayment would be affordable", exp=["comfortable_emi"]),
 chk("priorities", "Asks what matters most to the customer (EMI, interest cost, speed, amount, flexibility)", exp=["priority_main", "priority_secondary"]),
 chk("concerns", "Asks about the customer's concerns (charges, approval, repayment, documents, process)", exp=["concern_charges"]),
 chk("employment", "Asks about the customer's employment or source of income (including how long in the current job)", intents_=["employment", "employment_duration"], exp=["employment"]),
 chk("prior_borrowing", "Asks about previous loan experience", exp=["previous_loan"]),
 chk("preferred_tenure", "Asks the desired repayment period, where relevant", exp=["preferred_tenure"]),
]
L = lambda id, desc, cat="conversation": chk(id, desc, cat=cat, method="llm", intents_=[], credit="learner_action")
listening = [
 L("follows_up_timing_cue", "Follows up 'I need the money quite soon' by asking when exactly the funds are required"),
 L("follows_up_other_emi_cue", "Follows up 'I already have another EMI' by asking the amount or other current commitments"),
 L("follows_up_low_emi_cue", "Follows up 'I don't want a very high EMI' by exploring what monthly repayment would be comfortable"),
 L("follows_up_charges_cue", "Follows up 'My previous loan had extra charges' by asking what happened and what concerns the customer now"),
 L("acknowledges_information", "Acknowledges important information the customer shares before moving on"),
 L("clarifies_vague_info", "Clarifies vague, incomplete or contradictory information"),
 L("avoids_repeat_questions", "Does not ask a question the customer has already answered"),
]
needs = [
 L("identifies_main_need", "Identifies the customer's main borrowing need and key priority (an affordable monthly repayment)"),
 L("keeps_focus", "Keeps the conversation relevant to the loan requirement and redirects when it drifts"),
 L("summary_before_next_step", "Summarizes the customer's situation accurately (need, amount, timing, repayment comfort, concerns)"),
 L("confirms_summary", "Confirms the summary or understanding with the customer"),
]
clarity = [
 L("simple_language", "Uses simple words and avoids unnecessary jargon"),
 L("explains_jargon", "Explains anything complex in simple language"),
 L("one_question_at_a_time", "Asks one clear, reasonably short question at a time"),
 L("checks_understanding", "Checks the customer's understanding when appropriate"),
]
pitch = L("discovery_before_pitch", "Understands the need before recommending a product or asking for documents")

def dim(id, name, anchors, checks, method="hybrid"):
    return {"id": id, "name": name, "min_score": 1, "max_score": 5, "anchors": [{"score": s, "description": d, "basis": "source"} for s, d in anchors], "check_ids": checks, "evaluation_method": method, "applicability": "required"}
dims = [
 dim("questioning_discovery", "Questioning & Discovery Skills", [
   (1, "Mostly asks closed, unclear or unrelated questions. Misses important areas."),
   (2, "Asks some useful questions but misses several important areas or asks many closed/repetitive questions."),
   (3, "Asks a good mix of open and closed questions and covers most important areas."),
   (4, "Covers most important discovery areas and asks relevant questions, but misses one or two useful areas or opportunities."),
   (5, "Asks clear, relevant and well-sequenced questions that uncover both stated and unstated customer needs.")], [c["id"] for c in cov] + ["discovery_before_pitch"]),
 dim("active_listening", "Active Listening & Probing", [
   (1, "Moves to the next question without using the customer's response. Misses important information or cues."),
   (2, "Limited follow-up questioning. Frequently ignores useful information provided by the customer."),
   (3, "Listens to the customer and asks follow-up questions on important points."),
   (4, "Responds to most important cues and asks useful follow-ups, but misses a small number of opportunities."),
   (5, "Uses the customer's answers to decide what to ask next, explores important cues and clarifies unclear information.")], [c["id"] for c in listening], "llm"),
 dim("needs_conversation", "Understanding Customer Needs and Managing the Conversation", [
   (1, "Conversation is not well organized. Misses the main customer need or does not summarize it correctly."),
   (2, "Understands only part of the customer's need, allows the conversation to become unfocused or misses important priorities."),
   (3, "Keeps the conversation mostly focused and summarizes the main customer needs."),
   (4, "Understands the main need and manages the conversation well, with a mostly accurate summary."),
   (5, "Clearly identifies the customer's key needs and priorities, keeps the conversation on track and confirms understanding with the customer.")], [c["id"] for c in needs], "llm"),
 dim("clarity", "Communication Clarity", [
   (1, "Uses unclear, complicated or confusing language. Speaks too fast or gives long explanations."),
   (2, "Frequently difficult to understand because of unclear wording, long questions or unnecessary jargon."),
   (3, "Usually speaks clearly and uses simple language that the customer can understand."),
   (4, "Mostly clear and simple, with only occasional complicated wording or long questions."),
   (5, "Communicates in a clear, simple and confident way. Uses short sentences, appropriate language and checks that the customer understands.")], [c["id"] for c in clarity], "llm"),
]

def risk(id, desc, cat, sev, ex, cons, dims_):
    return {"id": id, "description": desc, "category": cat, "severity": sev, "detector": "hybrid", "examples": ex, "context_exclusions": EXCL, "consequence": cons, "dimension_ids": dims_}
risks = [
 risk("guaranteed_approval", "Promises approval or loan amount", "selling", "high", ["Your loan will definitely be approved.", "I guarantee you will get the full amount.", "Approval is certain, don't worry.", "You will surely get this loan."], "review", []),
 risk("documents_dismissed", "Dismisses required documentation", "process", "high", ["Don’t worry about documents.", "You don't need to submit any documents.", "Documents are not important for this loan."], "review", []),
 risk("optional_as_compulsory", "Misrepresents optional service as compulsory", "selling", "high", ["This optional service is compulsory.", "You have to buy this insurance to get the loan.", "This add-on is mandatory for everyone."], "review", []),
 risk("income_falsification", "Suggests falsifying income", "integrity", "high", ["We can increase your income in the application.", "Just write a higher salary on the form.", "Show more income so the loan gets approved."], "review", []),
 risk("charges_misrepresented", "Claims there are no charges or hides applicable charges", "selling", "high", ["There are no other charges at all.", "You will not pay any processing fee or other charges.", "There are absolutely no hidden or extra charges, I promise."], "review", []),
 risk("premature_pitch", "Pitches before understanding needs", "selling", "medium", ["You should take this loan now.", "Our loan is the best option for you.", "You should apply for our loan right away.", "We offer a great loan at a low interest rate, apply today."], "dimension_evidence", ["questioning_discovery"]),
 risk("premature_documents", "Pushes documentation before discovery", "process", "medium", ["Send your documents first; we can discuss your needs later.", "Please send me all your documents now.", "First submit your documents, then we will talk."], "dimension_evidence", ["questioning_discovery"]),
]

skills_guide = [
 {"dimension_id": "questioning_discovery", "measures": "Ability to ask relevant questions to understand the customer's situation, needs, priorities and concerns",
  "look_for": ["asks relevant questions rather than random or premature product questions", "uses open-ended questions where appropriate", "covers the important areas of loan discovery", "asks questions in a logical order", "explores the customer's needs, priorities and concerns", "avoids turning the conversation into a rigid checklist"],
  "score_guidance": [{"score": 5, "guidance": "Covers almost all important discovery areas using relevant, purposeful and well-sequenced questions. Goes beyond basic facts to understand priorities and concerns."}, {"score": 4, "guidance": "Covers most important discovery areas and asks relevant questions, but misses one or two useful areas or opportunities."}, {"score": 3, "guidance": "Understands the basic loan requirement but discovery is somewhat limited or checklist-driven."}, {"score": 2, "guidance": "Asks some useful questions but misses several important areas or asks many closed/repetitive questions."}, {"score": 1, "guidance": "Fails to understand the basic borrowing need or moves quickly to a solution without sufficient discovery."}]},
 {"dimension_id": "active_listening", "measures": "Ability to listen carefully, notice important customer information and ask useful follow-up questions",
  "look_for": ["acknowledges important customer information", "identifies cues or important statements", "asks follow-up questions based on those cues", "clarifies vague, incomplete or contradictory information", "avoids asking a question that the customer has already answered", "adapts the next question based on the customer's response"],
  "score_guidance": [{"score": 5, "guidance": "Consistently listens for important cues and uses them to ask relevant follow-up questions. Clarifies unclear information and explores important issues naturally."}, {"score": 4, "guidance": "Responds to most important cues and asks useful follow-ups, but misses a small number of opportunities."}, {"score": 3, "guidance": "Shows some listening and probing but often returns to prepared questions rather than building on customer responses."}, {"score": 2, "guidance": "Limited follow-up questioning. Frequently ignores useful information provided by the customer."}, {"score": 1, "guidance": "Mostly follows a script, repeats already answered questions or shows little evidence of listening to customer responses."}]},
 {"dimension_id": "needs_conversation", "measures": "Ability to understand the customer's main needs, keep the discussion focused and summarize what has been understood",
  "look_for": ["identifies the customer's main borrowing need", "distinguishes between important and less important information", "understands the customer's key priorities", "keeps the conversation relevant to the loan requirement", "redirects the discussion appropriately if it moves away from the purpose", "manages the 15-minute conversation reasonably well", "summarizes the customer's situation accurately", "confirms understanding with the customer"],
  "score_guidance": [{"score": 5, "guidance": "Clearly identifies the customer's main need and priorities, keeps the conversation focused and provides an accurate summary that is confirmed with the customer."}, {"score": 4, "guidance": "Understands the main need and manages the conversation well, with a mostly accurate summary."}, {"score": 3, "guidance": "Understands the basic need and keeps the conversation reasonably focused but provides a weak or incomplete summary."}, {"score": 2, "guidance": "Understands only part of the customer's need, allows the conversation to become unfocused or misses important priorities."}, {"score": 1, "guidance": "Does not clearly understand the customer's main need or fails to manage and summarize the conversation."}]},
 {"dimension_id": "clarity", "measures": "Ability to speak in a simple, clear and easy-to-understand manner",
  "look_for": ["uses simple words", "asks one clear question at a time", "avoids unnecessary jargon", "keeps questions reasonably short", "explains anything complex in simple language", "speaks in a professional and respectful manner", "avoids confusing or overly long questions", "checks understanding when appropriate", "does not heavily penalize grammar, accent or minor language mistakes if understanding is not affected"],
  "score_guidance": [{"score": 5, "guidance": "Communication is consistently clear, simple and easy to understand. Questions are concise and customer-friendly."}, {"score": 4, "guidance": "Mostly clear and simple, with only occasional complicated wording or long questions."}, {"score": 3, "guidance": "Generally understandable but sometimes uses complicated wording, jargon or lengthy questions."}, {"score": 2, "guidance": "Frequently difficult to understand because of unclear wording, long questions or unnecessary jargon."}, {"score": 1, "guidance": "Communication significantly affects the customer's ability to understand or respond appropriately."}]},
]
guide = {
 "skills": skills_guide,
 "level_labels": {"1": "Needs Improvement", "2": "Developing", "3": "Competent", "4": "Good", "5": "Excellent"},
 "framework_note": "This is a framework, not a mandatory checklist. The learner should not automatically lose points for failing to ask every question.",
 "framework": [
  {"area": "Loan purpose", "information": "Why the customer needs the money", "check_id": "loan_purpose"},
  {"area": "Loan amount", "information": "Approximate amount required", "check_id": "loan_amount"},
  {"area": "Cost breakup", "information": "What the amount covers: total cost, tuition, hostel, other expenses", "check_id": "cost_breakup"},
  {"area": "Own contribution", "information": "How much the customer will pay from own funds", "check_id": "own_contribution"},
  {"area": "Timing", "information": "When the funds are required", "check_id": "timing"},
  {"area": "Income", "information": "Approximate income or cash flow", "check_id": "income"},
  {"area": "Existing commitments", "information": "Existing EMIs or important financial obligations", "check_id": "existing_commitments"},
  {"area": "Repayment comfort", "information": "Approximate affordable monthly repayment", "check_id": "repayment_comfort"},
  {"area": "Customer priorities", "information": "EMI, interest cost, speed, loan amount, flexibility, etc.", "check_id": "priorities"},
  {"area": "Concerns", "information": "Charges, approval, repayment, documentation, process, etc.", "check_id": "concerns"},
  {"area": "Customer profile", "information": "Employment/business/source of income", "check_id": "employment"},
  {"area": "Prior borrowing", "information": "Previous loan experience where useful", "check_id": "prior_borrowing"},
  {"area": "Preferred tenure", "information": "Desired repayment period, if relevant", "check_id": "preferred_tenure"}],
 "cues": [
  {"fact_id": "cue_soon", "customer_line": "I need the money quite soon.", "expected_follow_up": "Ask when exactly the funds are required", "check_id": "follows_up_timing_cue"},
  {"fact_id": "cue_other_emi", "customer_line": "I already have another EMI.", "expected_follow_up": "Ask about the amount or current monthly commitments", "check_id": "follows_up_other_emi_cue"},
  {"fact_id": "cue_low_emi", "customer_line": "I don't want a very high EMI.", "expected_follow_up": "Explore what monthly repayment would be comfortable", "check_id": "follows_up_low_emi_cue"},
  {"fact_id": "cue_extra_charges", "customer_line": "My previous loan had extra charges.", "expected_follow_up": "Ask what happened and what concerns the customer has now", "check_id": "follows_up_charges_cue"}],
 "variations": [
  {"check_id": "repayment_comfort", "examples": ["What's a comfortable EMI for you?", "How much could you comfortably repay every month?", "What monthly payment would work for your budget?"]},
  {"check_id": "existing_commitments", "examples": ["Do you have any other EMIs?", "How much do you currently pay each month for other loans?", "You mentioned another EMI. How much is it?"]},
  {"check_id": "employment", "examples": ["What do you do for a living?", "Are you salaried or self-employed?", "How long have you been working in this company?"]},
  {"check_id": "cost_breakup", "examples": ["Can you give me the breakup of the ₹4 lakh?", "Is it only tuition, or hostel and food too?", "What is the total cost for the year?"]},
  {"check_id": "own_contribution", "examples": ["How much can you pay from your side?", "Will you put in some of your own savings?", "How much are you contributing yourself?"]},
  {"check_id": "timing", "examples": ["When exactly do you need the money?", "By what date do the fees have to be paid?", "How soon do you need the funds?"]}],
 "exclusions": [
  "Product knowledge should not affect Questioning & Discovery unless the learner asks an irrelevant or misleading question.",
  "Grammar should primarily affect Communication Clarity only when it interferes with understanding.",
  "Follow-up questions triggered by customer responses should primarily contribute to Active Listening & Probing.",
  "Summarizing customer needs should primarily contribute to Understanding Customer Needs and Managing the Conversation.",
  "The same behaviour can be referenced across skills when genuinely relevant, but the evaluator should explain why."],
 "principles": [
  "Score only what the learner demonstrates in the conversation; do not infer skills that were not observable.",
  "Base the assessment only on the conversation transcript and the customer profile provided for the simulation.",
  "Do not reward the learner for simply asking many questions. Judge whether the learner asked useful questions, understood the answers, followed up appropriately, kept the conversation focused, and communicated clearly.",
  "Do not penalize minor grammar or language mistakes if the learner's meaning is clear.",
  "Do not expect the learner to use the exact wording shown in the knowledge base. Equivalent questions and responses should receive the same credit.",
  "Score each skill independently using the defined rubric. For each score, provide evidence from the conversation and one specific coaching suggestion."]
}

hi = {"label": "हिन्दी", "review_status": "draft",
 "opening_text": "नमस्ते। मुझे एक लोन चाहिए, और पैसे जल्दी चाहिए। क्या आप मेरी मदद कर सकते हैं?",
 "learner_brief": "श्री शर्मा लोन के बारे में बात करने आए हैं। लगभग 15 मिनट में उनकी ज़रूरत, प्राथमिकताएँ और चिंताएँ समझिए। अभी कुछ बेचिए मत। अगला कदम सुझाने से पहले सारांश बताइए और उनसे पुष्टि कीजिए।",
 "unknown_response": "यह जानकारी अभी मेरे पास नहीं है।",
 "clarification_response": "आप क्या कहना चाह रहे हैं, थोड़ा समझाएँगे?",
 "acknowledgement_text": "अच्छा। आगे बताइए।",
 "rule_responses": {
  "respond_loan_purpose": "यह मेरी बेटी के कॉलेज एडमिशन के लिए है। उसकी फ़ीस भरनी है।",
  "respond_loan_amount": "मुझे लगभग ₹4 लाख चाहिए।",
  "respond_cost_breakup": "पहले साल का कुल खर्च लगभग ₹4.5 लाख है: लगभग ₹3 लाख ट्यूशन और एडमिशन, लगभग ₹1.2 लाख हॉस्टल और खाना, और लगभग ₹30,000 किताबें और बाकी खर्च।",
  "respond_own_contribution": "मैं अपनी बचत से लगभग ₹50,000 दे सकता हूँ। बाकी लगभग ₹4 लाख के लिए मुझे लोन चाहिए।",
  "respond_course_start": "क्लासें लगभग एक महीने में शुरू होंगी। इसीलिए फ़ीस 30 दिनों के अंदर भरनी है।",
  "respond_student_details": "उसका नाम प्रिया है। उसे पुणे के एक कॉलेज में B.Com में एडमिशन मिला है।",
  "respond_timing": "30 दिनों के अंदर। तब तक फ़ीस भरनी है।",
  "respond_employment": "मैं नौकरी करता हूँ, सैलरी पाता हूँ।",
  "respond_employment_duration": "मैं लगभग 8 साल से एक ही कंपनी में काम कर रहा हूँ।",
  "respond_income": "मैं महीने में लगभग ₹55,000 कमाता हूँ।",
  "respond_existing_commitments": "हाँ, मैं अपने वाहन लोन के लिए हर महीने ₹8,000 भरता हूँ।",
  "respond_repayment_comfort": "हर महीने लगभग ₹10,000 से ₹12,000 और ठीक रहेगा।",
  "respond_preferred_tenure": "मैंने अभी तय नहीं किया है। जितने में EMI आराम से भरी जा सके।",
  "respond_prior_borrowing": "हाँ, मैंने पहले वाहन लोन लिया था।",
  "respond_priorities": "मेरे लिए सबसे ज़रूरी है ऐसी EMI जो मैं हर महीने भर सकूँ। प्रोसेस जल्दी हो जाए तो वह भी अच्छा रहेगा।",
  "respond_concerns": "पिछली बार कुछ अतिरिक्त चार्ज देखकर मैं हैरान रह गया था। इस बार मुझे कोई छुपा हुआ चार्ज नहीं चाहिए।",
  "respond_premature_pitch": "उससे पहले मैं पक्का करना चाहता हूँ कि EMI मेरे बस में होगी।"},
 "cue_responses": {"low_emi": "लेकिन मैं नहीं चाहता कि EMI बहुत ज़्यादा हो।", "other_emi": "और मेरी एक EMI पहले से चल रही है।", "extra_charges": "और हाँ, पिछले लोन में कुछ अतिरिक्त चार्ज लगे थे।"},
 "intent_examples": {"loan_purpose": "आपको लोन किस लिए चाहिए?", "student_details": "आपकी बेटी का एडमिशन किस कॉलेज में हुआ है?", "cost_breakup": "इन ₹4 लाख में क्या-क्या शामिल है?", "employment_duration": "आप इस कंपनी में कितने साल से काम कर रहे हैं?", "own_contribution": "आप अपनी तरफ़ से कितना दे सकते हैं?", "course_start": "क्लासें कब से शुरू हैं?", "loan_amount": "आपको कितने लोन की ज़रूरत है?", "timing": "आपको पैसे ठीक कब तक चाहिए?", "employment": "आप क्या काम करते हैं?", "income": "आपकी महीने की आमदनी कितनी है?", "existing_commitments": "क्या आपकी कोई और EMI चल रही है?", "repayment_comfort": "हर महीने कितनी EMI आप आराम से भर सकते हैं?", "preferred_tenure": "आप कितने सालों में लोन चुकाना चाहेंगे?", "prior_borrowing": "क्या आपने पहले कभी लोन लिया है?", "priorities": "इस लोन में आपके लिए सबसे ज़रूरी क्या है?", "concerns": "लोन को लेकर आपकी कोई चिंता है?"},
 "retry_lead": "बातचीत का बीच वाला हिस्सा फिर से करें। इस बार कोई भी प्रोडक्ट बताने से पहले वे बातें पूछें जो छूट गई थीं। उदाहरण के लिए:",
 "reply_instruction": "Reply only in Hindi, written in Devanagari script, as a salaried middle-class father would speak. Keep the everyday English banking words people use (EMI, loan, fees). Write amounts with Western digits, for example ₹55,000.",
 "feedback_instruction": "Write every text and suggested_question field in simple Hindi, in Devanagari script. Keep common English banking words (EMI, loan). Quoted learner words must stay exactly as the learner wrote them."}
mr = {"label": "मराठी", "review_status": "draft",
 "opening_text": "नमस्कार. मला एक लोन हवं आहे, आणि पैसे लवकर हवे आहेत. तुम्ही मला मदत करू शकाल का?",
 "learner_brief": "श्री. शर्मा लोनबद्दल बोलायला आले आहेत. साधारण 15 मिनिटांत त्यांची गरज, प्राधान्यं आणि चिंता समजून घ्या. अजून काही विकू नका. पुढची पायरी सुचवण्याआधी सारांश सांगा आणि त्यांच्याकडून खात्री करून घ्या.",
 "unknown_response": "ही माहिती आत्ता माझ्याकडे नाही.",
 "clarification_response": "तुम्हाला नेमकं काय म्हणायचं आहे, जरा समजावून सांगाल का?",
 "acknowledgement_text": "बरं. पुढे सांगा.",
 "rule_responses": {
  "respond_loan_purpose": "माझ्या मुलीच्या कॉलेज प्रवेशासाठी. तिची फी भरायची आहे.",
  "respond_loan_amount": "मला साधारण ₹4 लाख हवे आहेत.",
  "respond_cost_breakup": "पहिल्या वर्षाचा एकूण खर्च साधारण ₹4.5 लाख आहे: साधारण ₹3 लाख ट्युशन आणि प्रवेश, साधारण ₹1.2 लाख हॉस्टेल आणि जेवण, आणि साधारण ₹30,000 पुस्तकं आणि इतर खर्च.",
  "respond_own_contribution": "मी माझ्या बचतीतून साधारण ₹50,000 देऊ शकतो. उरलेल्या साधारण ₹4 लाखांसाठी मला कर्ज हवं आहे.",
  "respond_course_start": "वर्ग साधारण एका महिन्यात सुरू होतील. म्हणूनच फी 30 दिवसांच्या आत भरायची आहे.",
  "respond_student_details": "तिचं नाव प्रिया. तिला पुण्यातल्या एका कॉलेजमध्ये B.Com ला प्रवेश मिळाला आहे.",
  "respond_timing": "30 दिवसांच्या आत. तोपर्यंत फी भरायची आहे.",
  "respond_employment": "मी पगारदार नोकरी करतो.",
  "respond_employment_duration": "मी साधारण 8 वर्षांपासून एकाच कंपनीत काम करतोय.",
  "respond_income": "मी महिन्याला साधारण ₹55,000 कमावतो.",
  "respond_existing_commitments": "हो, मी माझ्या वाहन कर्जासाठी दर महिन्याला ₹8,000 भरतो.",
  "respond_repayment_comfort": "दर महिन्याला साधारण ₹10,000 ते ₹12,000 अजून जमतील.",
  "respond_preferred_tenure": "मी अजून ठरवलं नाही. ज्यात EMI आरामात भरता येईल तेवढं.",
  "respond_prior_borrowing": "हो, मी आधी वाहन कर्ज घेतलं होतं.",
  "respond_priorities": "माझ्यासाठी सगळ्यात महत्त्वाचं म्हणजे दर महिन्याला भरता येईल असा EMI. प्रोसेस लवकर झाली तर तेही बरं.",
  "respond_concerns": "मागच्या वेळी काही जादा चार्जेस पाहून मला धक्काच बसला होता. या वेळी कोणतेही लपवलेले चार्जेस नकोत.",
  "respond_premature_pitch": "त्याआधी मला खात्री करायची आहे की EMI मला परवडेल."},
 "cue_responses": {"low_emi": "पण EMI खूप जास्त नको.", "other_emi": "आणि माझा एक EMI आधीच चालू आहे.", "extra_charges": "आणि हो, मागच्या कर्जात काही जादा चार्जेस लागले होते."},
 "intent_examples": {"loan_purpose": "तुम्हाला कर्ज कशासाठी हवं आहे?", "student_details": "तुमच्या मुलीला कोणत्या कॉलेजमध्ये प्रवेश मिळाला आहे?", "cost_breakup": "या ₹4 लाखांत काय काय येतं?", "employment_duration": "तुम्ही या कंपनीत किती वर्षांपासून काम करताय?", "own_contribution": "तुम्ही स्वतःकडून किती रक्कम देऊ शकाल?", "course_start": "वर्ग कधी सुरू होणार आहेत?", "loan_amount": "तुम्हाला किती कर्ज लागेल?", "timing": "तुम्हाला पैसे नेमके कधीपर्यंत हवे आहेत?", "employment": "तुम्ही काय काम करता?", "income": "तुमचं मासिक उत्पन्न किती आहे?", "existing_commitments": "तुमचा दुसरा कोणता EMI चालू आहे का?", "repayment_comfort": "दर महिन्याला किती EMI तुम्हाला आरामात भरता येईल?", "preferred_tenure": "किती वर्षांत कर्ज फेडायला आवडेल?", "prior_borrowing": "तुम्ही आधी कधी कर्ज घेतलं आहे का?", "priorities": "या कर्जात तुमच्यासाठी सगळ्यात महत्त्वाचं काय आहे?", "concerns": "कर्जाबद्दल तुम्हाला काही काळजी आहे का?"},
 "retry_lead": "संभाषणाचा मधला भाग पुन्हा करा. या वेळी कोणतंही प्रॉडक्ट सांगण्याआधी जे विचारायचं राहिलं ते विचारा. उदाहरणार्थ:",
 "reply_instruction": "Reply only in Marathi, written in Devanagari script, as a salaried middle-class father from Maharashtra would speak. Keep the everyday English banking words people use (EMI, loan, fees). Write amounts with Western digits, for example ₹55,000.",
 "feedback_instruction": "Write every text and suggested_question field in simple Marathi, in Devanagari script. Keep common English banking words (EMI, loan). Quoted learner words must stay exactly as the learner wrote them."}

runtime = {
 "question_free_intents": ["premature_pitch"],
 "discovery_gate": {"dimension_ids": ["questioning_discovery"], "min_asked_checks": 3},
 "discovery_conditioned": ["premature_pitch", "premature_documents"],
 "absence_checks": {
  "discovery_before_pitch": {"risk_rule_ids": ["premature_pitch", "premature_documents"], "requires_discovery": True},
  "avoids_repeat_questions": {"requires_discovery": True},
  "one_question_at_a_time": {"requires_discovery": True},
  "simple_language": {"unexplained_jargon": True, "requires_discovery": True},
  "explains_jargon": {"unexplained_jargon": True, "requires_discovery": True}},
 "check_cues": {
  "acknowledges_information": ["thank you for sharing", "thanks for sharing", "got it", "i see", "that helps", "noted", "understood"],
  "summary_before_next_step": ["to summarise", "to summarize", "let me summarise", "let me summarize", "just to recap", "so from what i understand", "if i understand correctly"],
  "confirms_summary": ["is that correct", "is that right", "did i get that right", "have i understood", "does that sound right"],
  "checks_understanding": ["does that make sense", "is that clear", "any questions", "shall i explain", "would you like me to explain", "is that okay"],
  "explains_jargon": ["which means", "that means", "in simple terms", "in other words", "simply put"]},
 "jargon_terms": ["LTV", "FOIR", "CIBIL", "collateral", "hypothecation", "amortisation", "amortization", "foreclosure", "moratorium"],
 "acknowledgement_text": "I see. Please go on.",
 "derivations": [],
 "translations": {"hi": hi, "mr": mr},
 "volunteered_cues": [
  {"id": "low_emi", "text": "But I don't want a very high EMI.", "reveal_fact_ids": ["cue_low_emi"], "after_learner_turns": 3, "with_intents": ["loan_amount"], "unless_fact_ids": ["comfortable_emi"]},
  {"id": "other_emi", "text": "And I already have another EMI.", "reveal_fact_ids": ["cue_other_emi"], "after_learner_turns": 5, "with_intents": ["income"], "unless_fact_ids": ["existing_emi"]},
  {"id": "extra_charges", "text": "Also, my previous loan had extra charges.", "reveal_fact_ids": ["cue_extra_charges"], "after_learner_turns": 7, "with_intents": ["prior_borrowing"], "unless_fact_ids": ["concern_charges"]}],
 "cue_follow_ups": [
  {"check_id": "follows_up_timing_cue", "cue_fact_ids": ["cue_soon"], "follow_up_intents": ["timing"]},
  {"check_id": "follows_up_other_emi_cue", "cue_fact_ids": ["cue_other_emi"], "follow_up_intents": ["existing_commitments"]},
  {"check_id": "follows_up_low_emi_cue", "cue_fact_ids": ["cue_low_emi"], "follow_up_intents": ["repayment_comfort"]},
  {"check_id": "follows_up_charges_cue", "cue_fact_ids": ["cue_extra_charges"], "follow_up_intents": ["concerns"]}],
 "evaluation_guide": guide,
 "reminder_minutes": [12, 15],
 "hidden_fact_terms": {
  "purpose": ["college", "fee", "fees", "admission", "education", "daughter", "student", "course", "studies", "tuition", "कॉलेज", "फ़ीस", "फीस", "एडमिशन", "बेटी", "पढ़ाई", "प्रवेश", "मुलगी", "शिक्षण", "फी"],
  "student_details": ["Priya", "B.Com", "Pune", "प्रिया", "पुणे", "पुण्या"],
  "cost_breakup": ["hostel", "हॉस्टल", "हॉस्टेल"],
  "own_contribution": ["savings", "बचत"]},
 "forbidden_terms": ["son", "sons", "बेटा", "बेटे", "मुलगा", "मुलाच्या", "मुलाला"],
}

all_checks = cov + [pitch] + listening + needs + clarity
bundle = {
 "schema_version": "1.0",
 "scenario": {"id": "EDU_DISCOVERY_001", "version": "4.1.0", "title": "Education Loan Discovery: Understanding the Student’s Funding Need", "product": "Education Loan", "skill": "Discovery Questions", "difficulty": "Intermediate", "locale": "en-IN",
  "learner_role": "Loan Sales Officer",
  "learner_brief": "Mr. Sharma has come in about a loan. In about 15 minutes, understand his need, priorities and concerns. Do not sell yet. Summarise what you have understood and confirm it with him before suggesting any next step.",
  "target_minutes": {"min": 12, "max": 15}, "objective_ids": [c["id"] for c in all_checks],
  "success_criteria": ["Understand the customer's need, priorities and concerns through relevant, well-sequenced questions.", "Listen for the customer's cues and follow them up.", "Keep the conversation focused, summarise and confirm understanding.", "Communicate simply and clearly, and avoid misleading statements."]},
 "persona": {"id": "rajesh_sharma", "version": "4.0.0", "name": "Rajesh Sharma", "role": "Salaried father of a student", "relationships": {}, "initial_emotion": "Polite but cautious",
  "speaking_style": "Brief natural answers; respond to the actual question without coaching.",
  "concerns": [{"id": "affordable_emi", "text": "Keeping the monthly repayment affordable", "fact_refs": ["cue_low_emi", "comfortable_emi"]}, {"id": "hidden_charges", "text": "Hidden or additional charges, after his last loan", "fact_refs": ["concern_charges"]}],
  "forbidden_inventions": ["Interest rate", "Processing fee or other charge amounts", "Employer name", "The college's name or fees", "A loan tenure", "Approval or guaranteed loan amount"]},
 "facts": facts,
 "conversation": {"opening_text": "Hello. I need a loan, and I need the money quite soon. Can you help me?", "intents": intents, "rules": rules, "unknown_response": "I don’t have that detail with me right now.", "clarification_response": "Could you explain what you mean?", "multi_intent_mode": "answer_asked_only", "off_topic_mode": "brief_redirect", "injection_mode": "stay_in_character", "max_new_facts_per_turn": 4},
 "rubric": {"id": "education_discovery", "version": "4.1.0", "title": "Loan Discovery Skills Rubric", "evidence_categories": ["coverage", "quality", "compliance", "conversation"], "dimensions": dims, "checks": all_checks},
 "risk_policy": {"id": "education_discovery_risks", "version": "2.0.0", "rules": risks},
 "scoring": {"id": "discovery_weighted", "version": "1.0.0", "mode": "weighted_percent", "weights": {"questioning_discovery": 30, "active_listening": 30, "needs_conversation": 25, "clarity": 15},
  "bands": [{"id": "needs_coaching", "label": "Needs Coaching", "lower": 0, "upper": 55, "upper_inclusive": False}, {"id": "developing", "label": "Developing", "lower": 55, "upper": 70, "upper_inclusive": False}, {"id": "effective", "label": "Effective", "lower": 70, "upper": 85, "upper_inclusive": False}, {"id": "strong", "label": "Strong", "lower": 85, "upper": 100, "upper_inclusive": True}],
  "band_scale": "percent", "display_decimals": 0, "risk_effect": "cap",
  "risk_effect_parameters": {"rule_ids": ["guaranteed_approval", "documents_dismissed", "optional_as_compulsory", "income_falsification", "charges_misrepresented"], "max_percent": 54}},
 "prompts": {"roleplay": "roleplay_v3", "evaluator": "evaluator_v3", "coach": "coach_v2"},
 "retry": {"full_enabled": True, "focused_enabled": True, "focused_target_check_ids": ["existing_commitments", "repayment_comfort", "concerns"], "focused_scoring": "checks_only",
  "instruction": "Repeat the middle part of the conversation. Ask about existing EMIs, a comfortable monthly repayment and the customer's concerns before explaining any loan option.", "version_policy": "pin_parent"},
 "provenance": [
  {"path": "/", "basis": "recommendation", "note": "Structure, IDs and runtime configuration are implementation recommendations unless a more specific record applies."},
  {"path": "/rubric/dimensions", "basis": "source", "source_ref": "SP rubric table + evaluator rubrics", "note": "Skill names, weights and anchors from the owner's 'Simulation Prototype' (30 Sep 2026). Anchors 1/3/5 use the report-format table wording; 2/4 use the document's evaluator rubric."},
  {"path": "/scoring", "basis": "source", "source_ref": "SP weights and interpretation", "note": "Weights 30/30/25/15, overall out of 100, bands 85–100 Strong, 70–84 Effective, 55–69 Developing, below 55 Needs Coaching. The 54 cap on serious risky statements is the owner's decision (1 Oct 2026)."},
  {"path": "/facts", "basis": "source", "source_ref": "SP customer profile", "note": "Customer profile and the important cue from the owner's document; cue facts and tenure wording are recommendations."},
  {"path": "/extensions/nd_runtime/evaluation_guide", "basis": "source", "source_ref": "SP knowledge base", "note": "Discovery framework, cues and expected follow-ups, acceptable variations, exclusions and principles from the owner's document."},
  {"path": "/extensions/nd_runtime/translations", "basis": "recommendation", "note": "Draft Hindi and Marathi translations; need a fluent reviewer."}],
 "extensions": {"nd_runtime": runtime},
}
json.dump(bundle, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
print("written", len(facts), "facts", len(intents), "intents", len(rules), "rules", len(all_checks), "checks")
