from __future__ import annotations

import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

try:
    import numpy as np
except Exception:
    np = None

try:
    from sentence_transformers import SentenceTransformer
except Exception:
    SentenceTransformer = None


logger = logging.getLogger("jobpulse-matcher")


# ============================================================
# CONFIG
# ============================================================

MODEL_NAME = os.getenv(
    "EMBEDDING_MODEL",
    os.getenv(
        "MATCHING_MODEL",
        "all-MiniLM-L6-v2",
    ),
)

EMBEDDING_BATCH_SIZE = int(
    os.getenv(
        "EMBEDDING_BATCH_SIZE",
        "64",
    )
)

MAX_CONTEXT_CHARS = int(
    os.getenv(
        "MATCH_CONTEXT_MAX_CHARS",
        "12000",
    )
)

# Keep wide retrieval.
# We rank the whole hard-filtered pool instead of throwing away
# potentially relevant jobs during candidate selection.
MAX_RANK_INPUT = int(
    os.getenv(
        "MAX_RANK_INPUT",
        "500",
    )
)

EXPERIENCE_NUMBER_WORDS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "thirteen": "13",
    "fourteen": "14",
    "fifteen": "15",
    "sixteen": "16",
    "seventeen": "17",
    "eighteen": "18",
    "nineteen": "19",
    "twenty": "20",
}

SOFTWARE_ENGINEERING_ALIASES = (
    "software development engineer",
    "software engineer",
    "software engineering",
    "software developer",
    "software trainee",
    "php developer",
    ".net core developer",
    "mern stack developer",
    "full stack developer",
    "full stack engineer",
    "frontend developer",
    "front end developer",
    "frontend engineer",
    "front end engineer",
    "backend developer",
    "back end developer",
    "backend engineer",
    "back end engineer",
    "web developer",
    "web development",
    "application developer",
    "react developer",
    "python developer",
    "java developer",
    "software tester",
    "software test engineer",
    "software quality assurance",
    "qa automation",
    "test automation engineer",
    "ai automation",
    "ai agent engineer",
    "forward deployed engineer",
    "forward-deployed engineer",
    "mobile app developer",
    "junior software engineer",
    "programmer",
)

ROLE_ALIASES = {
    "sde": SOFTWARE_ENGINEERING_ALIASES,
    "software engineer": SOFTWARE_ENGINEERING_ALIASES,
    "software engineering": SOFTWARE_ENGINEERING_ALIASES,
    "software development engineer": SOFTWARE_ENGINEERING_ALIASES,
}

DETECTABLE_JOB_SKILLS = (
    "React Native",
    "Next.js",
    "Node.js",
    "Vue.js",
    "NestJS",
    "Express.js",
    "Tailwind CSS",
    "scikit-learn",
    "Machine Learning",
    "Deep Learning",
    "Computer Vision",
    "Natural Language Processing",
    "Power BI",
    "Google Cloud",
    "GitHub Actions",
    "CI/CD",
    "ASP.NET",
    "Spring Boot",
    "Ruby on Rails",
    "Apache Kafka",
    "Amazon Web Services",
    "Microsoft Azure",
    "TensorFlow",
    "PyTorch",
    "PostgreSQL",
    "Elasticsearch",
    "Kubernetes",
    "Terraform",
    "Java",
    "JavaScript",
    "Python",
    "TypeScript",
    "Go",
    "C++",
    "C#",
    "C",
    "Rust",
    "Kotlin",
    "Swift",
    "Scala",
    "PHP",
    "Ruby",
    "Dart",
    "R",
    "SQL",
    "HTML",
    "CSS",
    "React",
    "Angular",
    "Vue",
    "Svelte",
    "Nuxt",
    "Express",
    "Django",
    "Flask",
    "FastAPI",
    "Spring",
    ".NET",
    "Laravel",
    "GraphQL",
    "REST APIs",
    "Microservices",
    "AWS",
    "Azure",
    "GCP",
    "Docker",
    "Jenkins",
    "Git",
    "Linux",
    "MySQL",
    "MongoDB",
    "Redis",
    "Kafka",
    "RabbitMQ",
    "Oracle",
    "DynamoDB",
    "Firebase",
    "Supabase",
    "Pandas",
    "NumPy",
    "Tableau",
    "Excel",
    "Selenium",
    "Playwright",
    "Cypress",
    "Jest",
    "pytest",
    "JUnit",
    "Agile",
    "Scrum",
)


# ============================================================
# BASIC HELPERS
# ============================================================

def clean_text(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        text = value
    elif isinstance(value, (list, tuple, set)):
        text = " ".join(
            clean_text(v)
            for v in value
        )
    elif isinstance(value, dict):
        text = " ".join(
            clean_text(v)
            for v in value.values()
        )
    else:
        text = str(value)

    text = re.sub(
        r"<script\b[^>]*>.*?</script>",
        " ",
        text,
        flags=re.I | re.S,
    )

    text = re.sub(
        r"<style\b[^>]*>.*?</style>",
        " ",
        text,
        flags=re.I | re.S,
    )

    text = re.sub(
        r"<[^>]+>",
        " ",
        text,
    )

    replacements = {
        "&nbsp;": " ",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def normalize_text(value: Any) -> str:
    return re.sub(
        r"\s+",
        " ",
        clean_text(value).lower(),
    ).strip()


def split_values(value: Any) -> List[str]:
    if value is None:
        return []

    if isinstance(value, str):
        parts = re.split(
            r"[,;|\n]+",
            value,
        )
    elif isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        parts = [value]

    result = []
    seen = set()

    for part in parts:
        text = clean_text(part)

        if not text:
            continue

        key = normalize_text(text)

        if key in seen:
            continue

        seen.add(key)
        result.append(text)

    return result


def tokens(value: Any) -> List[str]:
    text = normalize_text(value)

    values = re.findall(
        r"[a-z0-9]+(?:[+#./-][a-z0-9]+)*",
        text,
    )

    result = []
    seen = set()

    for value in values:
        value = value.strip(
            ".,;:()[]{}"
        )

        if not value:
            continue

        if value in seen:
            continue

        seen.add(value)
        result.append(value)

    return result


def token_set(value: Any) -> set[str]:
    return set(
        tokens(value)
    )


def clamp(
    value: float,
    low: float = 0.0,
    high: float = 100.0,
) -> float:
    try:
        value = float(value)
    except Exception:
        return low

    return max(
        low,
        min(high, value),
    )


def safe_float(
    value: Any,
    default: float = 0.0,
) -> float:
    try:
        return float(value)
    except Exception:
        return default


def phrase_match(
    query: str,
    text: str,
) -> bool:

    query = normalize_text(query)
    text = normalize_text(text)

    if not query or not text:
        return False

    return bool(
        re.search(
            r"(?<![a-z0-9])"
            + re.escape(query)
            + r"(?![a-z0-9])",
            text,
            flags=re.I,
        )
    )


def token_coverage(
    query: str,
    text: str,
) -> float:

    q = token_set(query)
    t = token_set(text)

    if not q:
        return 0.0

    return (
        len(q & t)
        / len(q)
    ) * 100.0


def token_overlap(
    left: str,
    right: str,
) -> float:

    a = token_set(left)
    b = token_set(right)

    if not a or not b:
        return 0.0

    union = a | b

    if not union:
        return 0.0

    return (
        len(a & b)
        / len(union)
    ) * 100.0


# ============================================================
# PROFILE
# ============================================================

class ProfileReader:

    @staticmethod
    def read(
        profile: Dict[str, Any],
        fields: Sequence[str],
    ) -> Any:

        for field in fields:

            value = profile.get(field)

            if value is None:
                continue

            if (
                isinstance(value, str)
                and not value.strip()
            ):
                continue

            if (
                isinstance(
                    value,
                    (list, tuple, set),
                )
                and not value
            ):
                continue

            return value

        return ""

    @staticmethod
    def target_role(
        profile: Dict[str, Any],
    ) -> str:
        roles = ProfileReader.target_roles(profile)
        return roles[0] if roles else ""

    @staticmethod
    def target_roles(
        profile: Dict[str, Any],
    ) -> List[str]:
        explicit = clean_text(
            ProfileReader.read(
                profile,
                ("targetRole", "desiredRole", "jobRole", "role", "careerGoal"),
            )
        )
        if explicit:
            return split_values(re.split(r"[|;]+", explicit))

        # Resume headlines often contain several interests separated by pipes.
        # Read those directly instead of imposing a fixed occupation catalog.
        resume_lines = re.split(
            r"\r?\n+",
            str(profile.get("resumeText", "")),
        )[:8]
        for line in resume_lines:
            line = clean_text(line)
            if "|" not in line or "@" in line:
                continue
            candidates = [part.strip() for part in line.split("|")]
            candidates = [
                part for part in candidates
                if len(part) >= 3 and not re.search(r"\d{5,}", part)
            ]
            # An education status is not a target occupation. Leaving it in
            # the role list makes generic titles such as "IT Undergraduate"
            # blur the recommendation boundary for actual job roles.
            candidates = [
                part for part in candidates
                if not re.search(r"\b(student|undergrad(?:uate)?)\b", part, flags=re.I)
            ]
            if candidates:
                return split_values(candidates)
        return []

    @staticmethod
    def resume_context(
        profile: Dict[str, Any],
    ) -> str:
        parts = [
            *ProfileReader.target_roles(profile),
            *ProfileReader.skills(profile),
            ProfileReader.bio(profile),
            ProfileReader.projects(profile),
            ProfileReader.education(profile),
            ProfileReader.certifications(profile),
            clean_text(profile.get("resumeText", "")),
        ]
        context = " ".join(part for part in parts if part)
        context = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", " ", context)
        context = re.sub(r"https?://\S+", " ", context)
        return clean_text(context)[:MAX_CONTEXT_CHARS]

    @staticmethod
    def looking_for(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "lookingFor",
                    "jobPreference",
                    "careerPreference",
                ),
            )
        )

    @staticmethod
    def location(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "preferredLocation",
                    "locationPreference",
                    "preferredLocations",
                ),
            )
        )

    @staticmethod
    def work_mode(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "preferredWorkMode",
                    "workMode",
                ),
            )
        )

    @staticmethod
    def industry(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "preferredIndustry",
                    "industry",
                ),
            )
        )

    @staticmethod
    def experience(
        profile: Dict[str, Any],
    ) -> str:
        value = clean_text(
            ProfileReader.read(
                profile,
                (
                    "experience",
                    "experienceLevel",
                    "yearsOfExperience",
                    "workExperience",
                ),
            )
        )
        return value

    @staticmethod
    def skills(
        profile: Dict[str, Any],
    ) -> List[str]:

        values = []

        for field in (
            "skills",
            "technicalSkills",
            "skillSet",
            "resumeSkills",
        ):
            values.extend(
                split_values(
                    profile.get(field)
                )
            )

        return split_values(
            values
        )

    @staticmethod
    def bio(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "bio",
                    "about",
                    "summary",
                ),
            )
        )

    @staticmethod
    def projects(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            profile.get(
                "projects",
                "",
            )
        )

    @staticmethod
    def education(
        profile: Dict[str, Any],
    ) -> str:

        education = profile.get(
            "education",
            "",
        )

        if isinstance(
            education,
            list,
        ):

            values = []

            for item in education:

                if isinstance(
                    item,
                    dict,
                ):

                    for field in (
                        "degree",
                        "field",
                        "specialization",
                        "institution",
                        "university",
                        "college",
                    ):

                        value = clean_text(
                            item.get(field)
                        )

                        if value:
                            values.append(
                                value
                            )

                else:

                    value = clean_text(
                        item
                    )

                    if value:
                        values.append(
                            value
                        )

            return " ".join(values)

        return clean_text(
            education
        )

    @staticmethod
    def certifications(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "certifications",
                    "certificates",
                ),
            )
        )

    @staticmethod
    def achievements(
        profile: Dict[str, Any],
    ) -> str:

        return clean_text(
            ProfileReader.read(
                profile,
                (
                    "achievements",
                    "accomplishments",
                ),
            )
        )


# ============================================================
# JOB DATA
# ============================================================

def job_title(
    job: Dict[str, Any],
) -> str:
    return clean_text(
        job.get("title")
    )


def job_company(
    job: Dict[str, Any],
) -> str:
    return clean_text(
        job.get("company")
    )


def job_location(
    job: Dict[str, Any],
) -> str:
    return clean_text(
        job.get("location")
    )


def job_description(
    job: Dict[str, Any],
) -> str:
    return clean_text(
        job.get("description")
    )


def detect_job_skills(
    job: Dict[str, Any],
) -> List[str]:
    values = []
    requirement_texts = [
        clean_text(job.get(field))
        for field in (
            "requirements",
            "qualifications",
            "responsibilities",
        )
        if clean_text(job.get(field))
    ]
    description = job_description(job)
    requirement_cue = re.compile(
        r"\b(?:requirements?|qualifications?|required(?: skills)?|"
        r"must[- ]have|proficiency in|proficient in|experience with|"
        r"knowledge of|familiar with|skills in|hands?[- ]on with|"
        r"expertise in|you should have|you will need)\b",
        flags=re.I,
    )
    for match in requirement_cue.finditer(description):
        requirement_texts.append(
            description[
                max(0, match.start() - 80):
                min(len(description), match.end() + 180)
            ]
        )

    searchable_text = " ".join(requirement_texts)
    for skill in DETECTABLE_JOB_SKILLS:
        suffix_pattern = (
            r"(?![A-Za-z0-9+#])"
            if skill == "C"
            else r"(?![A-Za-z0-9])"
        )
        pattern = (
            r"(?<![A-Za-z0-9])"
            + re.escape(skill)
            + suffix_pattern
        )
        flags = 0 if skill in {"C", "Go", "R"} else re.I
        if re.search(pattern, searchable_text, flags=flags):
            values.append(skill)

    result = []
    seen = set()

    for value in values:

        key = normalize_text(
            value
        )

        if not key:
            continue

        if key in seen:
            continue

        seen.add(key)
        result.append(value)

    return result


def job_skills(
    job: Dict[str, Any],
) -> List[str]:

    values = []

    for field in (
        "skills",
        "requiredSkills",
        "detectedJobSkills",
        "technologies",
    ):
        values.extend(
            split_values(
                job.get(field)
            )
        )

    if "detectedJobSkills" not in job:
        values.extend(detect_job_skills(job))

    result = []
    seen = set()

    for value in values:
        key = normalize_text(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)

    return result


def job_requirements(
    job: Dict[str, Any],
) -> str:

    return " ".join(
        value
        for value in (
            clean_text(
                job.get(
                    "requirements"
                )
            ),
            clean_text(
                job.get(
                    "qualifications"
                )
            ),
            clean_text(
                job.get(
                    "responsibilities"
                )
            ),
        )
        if value
    )


def job_search_text(
    job: Dict[str, Any],
) -> str:

    return " ".join(
        value
        for value in (
            job_company(job),
            job_title(job),
            " ".join(
                job_skills(job)
            ),
            job_requirements(job),
            job_description(job),
            job_location(job),
        )
        if value
    )


# ============================================================
# EMBEDDINGS
# ============================================================

class EmbeddingEngine:

    def __init__(self):

        self.model = None
        self.cache: Dict[str, Any] = {}

        if SentenceTransformer is None:
            logger.warning(
                "SentenceTransformer unavailable."
            )
            return

        try:

            logger.info(
                "Loading embedding model: %s",
                MODEL_NAME,
            )

            self.model = SentenceTransformer(
                MODEL_NAME
            )

            logger.info(
                "Embedding model loaded."
            )

        except Exception as error:

            logger.error(
                "Embedding model load failed: %s",
                error,
            )

            self.model = None

    def enabled(self) -> bool:

        value = normalize_text(
            os.getenv(
                "MATCH_ENABLE_SEMANTIC",
                "1",
            )
        )

        return (
            self.model is not None
            and value not in {
                "0",
                "false",
                "off",
                "no",
            }
        )

    def encode(
        self,
        text: str,
    ):

        if not self.enabled():
            return None

        text = clean_text(
            text
        )

        if not text:
            return None

        key = normalize_text(
            text
        )

        if key in self.cache:
            return self.cache[key]

        try:

            embedding = self.model.encode(
                [text],
                normalize_embeddings=True,
                show_progress_bar=False,
            )[0]

            self.cache[key] = embedding

            return embedding

        except Exception as error:

            logger.warning(
                "Embedding failed: %s",
                error,
            )

            return None

    def similarity(
        self,
        left: str,
        right: str,
    ) -> float:

        if not self.enabled():
            return 0.0

        if not left or not right:
            return 0.0

        a = self.encode(
            left
        )

        b = self.encode(
            right
        )

        if a is None or b is None:
            return 0.0

        try:

            if np is not None:

                cosine = float(
                    np.dot(
                        a,
                        b,
                    )
                )

            else:

                numerator = sum(
                    float(x) * float(y)
                    for x, y in zip(
                        a,
                        b,
                    )
                )

                norm_a = math.sqrt(
                    sum(
                        float(x) ** 2
                        for x in a
                    )
                )

                norm_b = math.sqrt(
                    sum(
                        float(y) ** 2
                        for y in b
                    )
                )

                if (
                    norm_a == 0
                    or norm_b == 0
                ):
                    return 0.0

                cosine = (
                    numerator
                    / (
                        norm_a
                        * norm_b
                    )
                )

            cosine = max(
                -1.0,
                min(
                    1.0,
                    cosine,
                ),
            )

            return clamp(
                (
                    cosine + 1.0
                ) * 50.0
            )

        except Exception:
            return 0.0

    def preload(
        self,
        texts: Sequence[str],
    ) -> None:

        if not self.enabled():
            return

        unique = []
        seen = set()

        for text in texts:

            text = clean_text(
                text
            )

            if not text:
                continue

            key = normalize_text(
                text
            )

            if key in seen:
                continue

            seen.add(key)

            if key in self.cache:
                continue

            unique.append(text)

        if not unique:
            return

        try:

            embeddings = self.model.encode(
                unique,
                batch_size=EMBEDDING_BATCH_SIZE,
                normalize_embeddings=True,
                show_progress_bar=False,
            )

            for text, embedding in zip(
                unique,
                embeddings,
            ):

                self.cache[
                    normalize_text(text)
                ] = embedding

        except Exception as error:

            logger.warning(
                "Embedding preload failed: %s",
                error,
            )


# ============================================================
# SEARCH MATCHING
# ============================================================

def search_match(
    query: str,
    job: Dict[str, Any],
    embeddings: EmbeddingEngine,
) -> Dict[str, Any]:

    query = clean_text(
        query
    )

    if not query:

        return {
            "relevant": True,
            "score": 0.0,
            "company": 0.0,
            "title": 0.0,
            "skills": 0.0,
            "requirements": 0.0,
            "description": 0.0,
            "location": 0.0,
            "semantic": 0.0,
        }

    company = job_company(
        job
    )

    location = job_location(
        job
    )

    title = job_title(
        job
    )

    skills = " ".join(
        job_skills(job)
    )

    requirements = job_requirements(
        job
    )

    description = job_description(
        job
    )

    company_score = token_coverage(
        query,
        company,
    )

    location_score = token_coverage(
        query,
        location,
    )

    title_score = token_coverage(
        query,
        title,
    )

    skill_score = token_coverage(
        query,
        skills,
    )

    requirement_score = token_coverage(
        query,
        requirements,
    )

    description_score = token_coverage(
        query,
        description,
    )

    exact_company = (
        100.0
        if phrase_match(
            query,
            company,
        )
        else 0.0
    )

    exact_title = (
        100.0
        if phrase_match(
            query,
            title,
        )
        else 0.0
    )

    # Search semantic similarity against title.
    semantic_title = embeddings.similarity(
        query,
        title,
    )

    # Search semantic similarity against all useful job text (truncated to 400 chars)
    search_context = job_search_text(job)[:400]
    if max(exact_company, company_score, exact_title, title_score, skill_score) >= 70.0:
        semantic_full = 0.0
    else:
        semantic_full = embeddings.similarity(
            query,
            search_context,
        )

    score = max(
        exact_company,
        company_score,
        exact_title,
        title_score,
        skill_score,
        requirement_score,
        description_score,
        location_score,
        semantic_title,
        semantic_full,
    )

    query_tokens = token_set(
        query
    )

    # A description mention alone is weak evidence for a role search: broad
    # terms such as "finance" can appear in unrelated company descriptions.
    # Use titles, companies, skills, and requirements to establish relevance.
    if (
        phrase_match(query, title)
        or phrase_match(query, company)
        or phrase_match(query, skills)
    ):
        relevant = True
        score = max(score, 65.0)
    elif exact_company >= 100 or company_score >= 50:
        relevant = True
    elif exact_title >= 100:
        relevant = True
    elif title_score >= 50:
        relevant = True
    elif skill_score >= 50:
        relevant = True
    elif requirement_score >= 50:
        relevant = True
    elif semantic_title >= 70:
        relevant = True
    elif (
        len(query_tokens) >= 1
        and any(
            phrase_match(t, title)
            or phrase_match(t, skills)
            or phrase_match(t, company)
            for t in query_tokens if len(t) >= 2
        )
    ):
        relevant = True
        score = max(score, 55.0)
    elif (
        semantic_full >= 75
        and (
            company_score >= 15
            or title_score >= 15
            or skill_score >= 15
            or requirement_score >= 15
        )
    ):
        relevant = True
    else:
        relevant = False

    return {
        "relevant":
            relevant,

        "score":
            round(
                clamp(score),
                2,
            ),

        "company":
            round(
                clamp(
                    max(
                        exact_company,
                        company_score,
                    )
                ),
                2,
            ),

        "title":
            round(
                clamp(title_score),
                2,
            ),

        "skills":
            round(
                clamp(skill_score),
                2,
            ),

        "requirements":
            round(
                clamp(requirement_score),
                2,
            ),

        "description":
            round(
                clamp(description_score),
                2,
            ),

        "location":
            round(
                clamp(location_score),
                2,
            ),

        "semantic":
            round(
                clamp(
                    max(
                        semantic_title,
                        semantic_full,
                    )
                ),
                2,
            ),
    }


# ============================================================
# PROFILE ROLE MATCH
# ============================================================

def profile_role_match(
    target_role: str,
    job: Dict[str, Any],
    embeddings: EmbeddingEngine,
) -> Dict[str, Any]:

    target_role = clean_text(
        target_role
    )

    if not target_role:

        return {
            "relevant": True,
            "score": 0.0,
            "titleScore": 0.0,
            "titleOverlap": 0.0,
            "semanticTitle": 0.0,
        }

    title = job_title(
        job
    )

    # ONLY TITLE is allowed to establish role relevance.
    # Description semantic similarity cannot turn an unrelated
    # title into a relevant role.
    role_terms = (
        target_role,
        *ROLE_ALIASES.get(normalize_text(target_role), ()),
    )
    title_scores = [
        (
            token_coverage(role_term, title),
            token_overlap(role_term, title),
            100.0 if phrase_match(role_term, title) else 0.0,
            embeddings.similarity(role_term, title),
        )
        for role_term in role_terms
    ]
    title_score = max(item[0] for item in title_scores)
    title_overlap = max(item[1] for item in title_scores)
    exact = max(item[2] for item in title_scores)
    semantic_title = max(item[3] for item in title_scores)

    score = max(
        exact,
        title_score,
        title_overlap,
        semantic_title,
    )

    relevant = False

    if exact >= 100:
        relevant = True

    elif title_score >= 75:
        relevant = True

    elif title_overlap >= 40:
        relevant = True

    # Resume headlines and job titles often use different wording, for
    # example "Full Stack Developer" and "Software Engineer Intern".
    # Allow a strong title-only semantic match to establish role relevance;
    # description similarity alone still cannot make an unrelated title pass.
    elif semantic_title >= 85:
        relevant = True

    return {
        "relevant":
            relevant,

        "score":
            round(
                clamp(score),
                2,
            ),

        "titleScore":
            round(
                clamp(title_score),
                2,
            ),

        "titleOverlap":
            round(
                clamp(title_overlap),
                2,
            ),

        "semanticTitle":
            round(
                clamp(semantic_title),
                2,
            ),
    }


# ============================================================
# SKILL MATCH
# ============================================================

def skill_match(
    profile_skills: List[str],
    job: Dict[str, Any],
) -> Dict[str, Any]:
    explicit_job_skills = job_skills(job)
    normalized_job_skills = {
        normalize_text(skill)
        for skill in explicit_job_skills
    }
    searchable_job_text = normalize_text(
        job_search_text(job)
    )

    matched = []

    for profile_skill in profile_skills:

        normalized_profile_skill = normalize_text(
            profile_skill
        )

        found = False

        for job_skill in normalized_job_skills:

            if (
                normalized_profile_skill
                == job_skill
            ):
                found = True
                break

            if phrase_match(
                normalized_profile_skill,
                job_skill,
            ):
                found = True
                break

            if (
                token_coverage(
                    normalized_profile_skill,
                    job_skill,
                )
                >= 70.0
            ):
                found = True
                break

        if not found and phrase_match(
            normalized_profile_skill,
            searchable_job_text,
        ):
            found = True

        if found:
            matched.append(
                profile_skill
            )

    score = (
        len(matched) / len(profile_skills) * 100.0
        if profile_skills
        else 0.0
    )

    normalized_profile_skills = {
        normalize_text(skill)
        for skill in profile_skills
    }
    missing = [
        skill for skill in explicit_job_skills
        if normalize_text(skill) not in normalized_profile_skills
    ]

    return {
        "score":
            round(
                clamp(score),
                2,
            ),

        "matched":
            matched,
            

        "missing":
            missing,

        "available": bool(explicit_job_skills),
        "profileAvailable": bool(profile_skills),
    }


# ============================================================
# EXPERIENCE
# ============================================================

def parse_years(
    value: Any,
) -> Optional[float]:

    text = normalize_text(
        value
    )

    if not text:
        return None

    values = re.findall(
        r"(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?)",
        text,
        flags=re.I,
    )

    if not values:
        return None

    numbers = []

    for value in values:

        try:
            numbers.append(
                float(value)
            )
        except Exception:
            pass

    return (
        max(numbers)
        if numbers
        else None
    )


def _parse_date(value: Any) -> Optional[datetime]:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    text = clean_text(value)
    if not text:
        return None

    for candidate in (
        text,
        text.replace("Z", "+00:00"),
    ):
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass

    try:
        import pandas as pd

        parsed = pd.to_datetime(text, errors="coerce", utc=True)
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime().astimezone(timezone.utc)
    except Exception:
        return None


def _employment_intervals_from_text(value: Any) -> List[tuple]:
    if not value:
        return []

    text = re.sub(r"<[^>]+>", "\n", str(value), flags=re.I)
    month = (
        r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
        r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|"
        r"nov(?:ember)?|dec(?:ember)?)"
    )
    date = (
        rf"(?:{month}[,.]?\s+\d{{4}}|\d{{1,2}}/\d{{4}}|"
        r"\d{4}[-/]\d{1,2}|\d{4})"
    )
    range_pattern = re.compile(
        rf"(?P<start>{date})\s*(?:-|–|—|\bto\b|\bthrough\b)\s*"
        rf"(?P<end>{date}|\bpresent\b|\bcurrent\b|\bnow\b)",
        flags=re.I,
    )
    intervals = []
    for match in range_pattern.finditer(text):
        start = _parse_date(match.group("start").strip(" ,"))
        raw_end = match.group("end").strip(" ,")
        end = (
            datetime.now(timezone.utc)
            if raw_end.lower() in {"present", "current", "now"}
            else _parse_date(raw_end)
        )
        if start is not None and end is not None:
            if end < start:
                start, end = end, start
            intervals.append((start, end))
    return intervals


def _merged_experience_years(intervals: List[tuple]) -> Optional[float]:
    if not intervals:
        return None

    intervals.sort(key=lambda pair: pair[0])
    merged = [list(intervals[0])]
    for start, end in intervals[1:]:
        _, last_end = merged[-1]
        if start <= last_end:
            merged[-1][1] = max(last_end, end)
        else:
            merged.append([start, end])

    total_days = sum(
        (end - start).total_seconds() / 86400
        for start, end in merged
    )
    return total_days / 365.25


def _profile_years(profile: Dict[str, Any]) -> Optional[float]:
    raw_experience = ProfileReader.read(
        profile,
        (
            "yearsOfExperience",
            "experience",
            "experienceLevel",
            "workExperience",
        ),
    )

    if isinstance(raw_experience, (int, float)):
        return max(0.0, float(raw_experience))

    normalized_experience = clean_text(raw_experience)
    if re.fullmatch(r"\d+(?:\.\d+)?", normalized_experience):
        return max(0.0, float(normalized_experience))

    parsed = parse_years(raw_experience)
    if parsed is not None:
        return float(parsed)

    if re.search(
        r"\bfresher\b|\b0 years?\b|\bno experience\b|\bentry[- ]level\b",
        clean_text(raw_experience),
        flags=re.I,
    ):
        return 0.0

    intervals = _employment_intervals_from_text(raw_experience)
    if isinstance(raw_experience, list):
        for item in raw_experience:
            if not isinstance(item, dict):
                continue

            start = _parse_date(
                item.get("startDate") or item.get("start") or item.get("from")
            )
            end = _parse_date(
                item.get("endDate") or item.get("end") or item.get("to")
            )
            if start is None:
                continue
            if end is None:
                end = datetime.now(timezone.utc)
            if end < start:
                start, end = end, start
            intervals.append((start, end))

    experience_years = _merged_experience_years(intervals)
    if experience_years is not None:
        return experience_years

    resume_text = profile.get("resumeText", "")
    resume_years = parse_years(resume_text)
    if resume_years is not None:
        return float(resume_years)

    resume_sections = list(
        re.finditer(
            r"(?im)^\s*(?:professional\s+experience|work\s+experience"
            r"(?:\s+and\s+internships)?|employment(?:\s+history)?|"
            r"work\s+history|career\s+history|internships?"
            r"(?:\s+experience)?|professional\s+background|experience)"
            r"\s*:?\s*$",
            str(resume_text or ""),
        )
    )
    if not resume_sections:
        return None

    section_start = resume_sections[0].end()
    following_section = re.search(
        r"(?im)^\s*(?:education|skills|projects|certifications|"
        r"achievements|interests|references|languages)\s*:?\s*$",
        str(resume_text or "")[section_start:],
    )
    section_end = (
        section_start + following_section.start()
        if following_section
        else len(str(resume_text or ""))
    )
    return _merged_experience_years(
        _employment_intervals_from_text(
            str(resume_text or "")[section_start:section_end]
        )
    )


def extract_experience_requirement(text: Any) -> Dict[str, Optional[float]]:
    raw_text = str(text or "")
    raw_text = re.sub(
        r"<[^>]+>",
        "\n",
        raw_text,
        flags=re.I,
    )
    fresher_requirement = False
    no_experience_requirement = False
    sentences = (
        clean_text(sentence)
        for sentence in re.split(
            r"(?<=[!?;])\s+|(?<!\d)\.(?!\d)\s+|\n+",
            raw_text,
        )
    )
    for sentence in sentences:
        sentence = sentence.strip(" -:|")
        if not sentence:
            continue

        word_pattern = "|".join(EXPERIENCE_NUMBER_WORDS)
        sentence = re.sub(
            rf"\b(?P<min>{word_pattern})\s*(?:to|-)\s*"
            rf"(?P<max>{word_pattern})\s*(?P<unit>years?|yrs?)\b",
            lambda match: (
                f"{EXPERIENCE_NUMBER_WORDS[match.group('min').lower()]} to "
                f"{EXPERIENCE_NUMBER_WORDS[match.group('max').lower()]} "
                f"{match.group('unit')}"
            ),
            sentence,
            flags=re.I,
        )
        sentence = re.sub(
            rf"\b(?P<years>{word_pattern})\s*(?P<unit>years?|yrs?)\b",
            lambda match: (
                f"{EXPERIENCE_NUMBER_WORDS[match.group('years').lower()]} "
                f"{match.group('unit')}"
            ),
            sentence,
            flags=re.I,
        )
        lowered = sentence.lower()
        if re.search(
            r"\b(company|organization|team|business|firm|org)\b.*"
            r"\b(?:over|more than|nearly|almost)\b",
            lowered,
        ):
            continue
        if re.search(
            r"\b(company|organization|team|business|firm|org)\b.{0,50}"
            r"\b(?:has|have|boasts?)\b.{0,40}\b\d+(?:\.\d+)?\s*"
            r"(?:years?|yrs?)\b.{0,50}\bexperience\b",
            lowered,
        ):
            continue

        fresher_requirement = fresher_requirement or bool(
            re.search(r"\bfreshers?\b", lowered)
        )
        no_experience_requirement = no_experience_requirement or bool(
            re.search(
                r"\b(?:no|without)\s+(?:prior\s+|previous\s+|any\s+)?"
                r"(?:work\s+)?experience\s+(?:is\s+)?(?:required|necessary|needed)\b"
                r"|\b(?:zero experience|0 years? experience)\b",
                lowered,
            )
        )

        match = re.search(
            r"\bup\s+to\s+(?P<max>\d+(?:\.\d+)?)\s*"
            r"(?:years?|yrs?)\b",
            sentence,
            flags=re.I,
        )
        if match and re.search(
            r"\bexperience\b|\bexp\b|\brole\b|\bposition\b",
            lowered,
        ):
            return {
                "min_years": None,
                "max_years": float(match.group("max")),
            }

        match = re.search(
            r"\b(?P<min>\d+(?:\.\d+)?)\s*(?:to|-)\s*"
            r"(?P<max>\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b",
            sentence,
            flags=re.I,
        )
        if match:
            context = sentence.lower()
            if re.search(r"\bexperience\b|\bexp\b|\bminimum\b|\brequired\b|\bmust\b|\bpreferred\b", context):
                return {
                    "min_years": float(match.group("min")),
                    "max_years": float(match.group("max")),
                }

        match = re.search(
            r"\b(?P<min>\d+(?:\.\d+)?)\s*(?:\+|plus)\s*(?:years?|yrs?)\b",
            sentence,
            flags=re.I,
        )
        if match:
            context = sentence.lower()
            preceding = context[:match.start()]
            following = context[match.end():match.end() + 80]
            if re.search(
                r"\bexperience\b|\bexp\b|\bminimum\b|\brequired\b|\brequire\b|"
                r"\bmust\b|\bat least\b|\bprofessional\b|\brelevant\b",
                preceding + " " + following,
            ):
                return {
                    "min_years": float(match.group("min")),
                    "max_years": None,
                }

        match = re.search(
            r"\b(?P<min>\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b",
            sentence,
            flags=re.I,
        )
        if match:
            preceding = lowered[:match.start()]
            following = lowered[match.end():match.end() + 100]
            if (
                re.search(
                    r"\b(?:at\s+least|minimum|required|require|must\s+have|"
                    r"needs?|preferred|experience\s*[:=-])\b",
                    preceding,
                )
                or re.search(
                    r"\b(?:of\s+)?(?:relevant\s+|professional\s+|work\s+|"
                    r"industry\s+)?experience\b|\bexp\b",
                    following,
                )
            ):
                return {
                    "min_years": float(match.group("min")),
                    "max_years": None,
                }

    if fresher_requirement:
        return {"min_years": 0.0, "max_years": 2.0}
    if no_experience_requirement:
        return {"min_years": 0.0, "max_years": None}
    return {"min_years": None, "max_years": None}


def job_experience_requirement(job: Dict[str, Any]) -> Dict[str, Any]:
    for minimum_field, maximum_field in (
        ("minExperienceYears", "maxExperienceYears"),
        ("requiredMinYears", "requiredMaxYears"),
    ):
        minimum = job.get(minimum_field)
        maximum = job.get(maximum_field)
        if minimum is not None or maximum is not None:
            try:
                return {
                    "min_years": float(minimum) if minimum is not None else None,
                    "max_years": float(maximum) if maximum is not None else None,
                    "source": "structured",
                }
            except (TypeError, ValueError):
                pass

    for field in ("experience", "experienceLevel", "requiredExperience"):
        value = job.get(field)
        requirement = extract_experience_requirement(value)
        if requirement["min_years"] is not None or requirement["max_years"] is not None:
            requirement["source"] = "experience field"
            return requirement
        exact_match = re.fullmatch(
            r"\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*",
            clean_text(value),
            flags=re.I,
        )
        if exact_match:
            years = float(exact_match.group(1))
            return {
                "min_years": years,
                "max_years": None,
                "source": "experience field",
            }
        if isinstance(value, (int, float)) or re.fullmatch(
            r"\s*\d+(?:\.\d+)?\s*",
            clean_text(value),
        ):
            try:
                years = float(value)
            except (TypeError, ValueError):
                years = float(clean_text(value))
            return {
                "min_years": years,
                "max_years": years,
                "source": "experience field",
            }

    for field in ("requirements", "qualifications", "description"):
        requirement = extract_experience_requirement(job.get(field))
        if requirement["min_years"] is not None or requirement["max_years"] is not None:
            requirement["source"] = "job description" if field == "description" else field
            return requirement

    return {
        "min_years": None,
        "max_years": None,
        "source": "",
    }


def experience_requirement_label(requirement: Dict[str, Any]) -> str:
    minimum = requirement.get("min_years")
    maximum = requirement.get("max_years")
    if minimum is None and maximum is None:
        return ""
    if minimum == 0 and maximum is None:
        return "No experience required"
    if minimum is not None and maximum is not None:
        if minimum == maximum:
            return f"{minimum:g} years"
        return f"{minimum:g} - {maximum:g} years"
    if minimum is not None:
        return f"{minimum:g}+ years"
    return f"Up to {maximum:g} years"


def experience_match(
    profile_experience: str,
    job: Dict[str, Any],
    profile: Optional[Dict[str, Any]] = None,
) -> float:

    profile_text = normalize_text(
        profile_experience
    )
    if profile:
        profile_text = normalize_text(
            f"{profile_text} {profile.get('lookingFor', '')} "
            f"{profile.get('targetRole', '')} {profile.get('resumeText', '')}"
        )

    job_title_text = normalize_text(job_title(job))
    job_type_text = normalize_text(job.get("jobType", ""))
    job_text = normalize_text(
        " ".join(
            [
                job_title_text,
                job_type_text,
                clean_text(
                    job.get(
                        "experience"
                    )
                ),
                job_requirements(job),
                job_description(job),
            ]
        )
    )

    if not profile_text:
        return 50.0

    profile_years = parse_years(profile_text)
    if profile is not None:
        recorded_years = _profile_years(profile)
        if recorded_years is not None:
            profile_years = recorded_years

    experience_requirement = job_experience_requirement(job)
    job_years = experience_requirement["min_years"]

    profile_fresher = bool(
        re.search(
            r"\bfresher\b"
            r"|\b0 years?\b"
            r"|\bno experience\b"
            r"|\bentry[- ]level\b",
            profile_text,
            flags=re.I,
        )
    )

    if profile_years is None and profile_fresher:
        profile_years = 0.0

    if profile_years is None:
        return 50.0

    minimum_years = experience_requirement["min_years"]
    maximum_years = experience_requirement["max_years"]

    if (
        profile_years is not None
        and (minimum_years is not None or maximum_years is not None)
    ):
        gap = 0.0
        if minimum_years is not None and profile_years < minimum_years:
            gap = minimum_years - profile_years
        elif maximum_years is not None and profile_years > maximum_years:
            gap = profile_years - maximum_years

        if gap == 0:
            return 100.0

        return clamp(100.0 - gap * 25.0)

    job_fresher = bool(
        re.search(
            r"\bfresher\b"
            r"|\b0 years?\b"
            r"|\bno experience\b"
            r"|\bentry[- ]level\b"
            r"|\bintern\b"
            r"|\binternship\b"
            r"|\btrainee\b"
            r"|\bapprentice\b"
            r"|\bnew grad\b",
            job_text,
            flags=re.I,
        )
    )

    job_senior = bool(
        re.search(
            r"\b(senior|staff|principal|lead|director|manager|head)\b",
            job_title_text,
            flags=re.I,
        )
    )

    if (
        profile_years is not None
        and job_years is not None
    ):

        if profile_years >= job_years:
            return 100.0

        difference = (
            job_years
            - profile_years
        )

        return clamp(
            100.0
            - difference * 25.0
        )

    if (
        profile_fresher
        and job_fresher
    ):
        return 100.0

    if profile_fresher and job_senior:
        return 15.0

    if profile_fresher:

        if job_fresher:
            return 100.0

        return 60.0

    return 50.0


def experience_within_tolerance(
    profile: Dict[str, Any],
    job: Dict[str, Any],
    tolerance: Optional[float] = None,
) -> bool:
    raw_experience = ProfileReader.read(
        profile,
        (
            "yearsOfExperience",
            "experience",
            "experienceLevel",
            "workExperience",
        ),
    )
    profile_text = clean_text(raw_experience)
    profile_years = _profile_years(profile)

    if profile_years is None and re.search(
        r"\bfresher\b|\b0 years?\b|\bno experience\b|\bentry[- ]level\b",
        profile_text,
        flags=re.I,
    ):
        profile_years = 0.0
    elif profile_years is None and re.fullmatch(
        r"\s*\d+(?:\.\d+)?\s*",
        profile_text,
    ):
        profile_years = float(profile_text)

    requirement = job_experience_requirement(job)

    minimum_years = requirement["min_years"]
    maximum_years = requirement["max_years"]
    job_text = normalize_text(
        " ".join(
            (
                job_title(job),
                clean_text(job.get("experience")),
                job_requirements(job),
                job_description(job),
            )
        )
    )
    job_fresher = bool(re.search(r"\bfreshers?\b", job_text, flags=re.I))
    if minimum_years is None and maximum_years is None:
        if job_fresher:
            minimum_years, maximum_years = 0.0, 2.0
        elif re.search(
            r"\b0 years?\b|\bno experience\b|\bentry[- ]level\b|"
            r"\bintern(ship)?\b|\btrainee\b|\bapprentice\b|\bnew grad\b",
            job_text,
            flags=re.I,
        ):
            minimum_years = maximum_years = 0.0

    if minimum_years is None and maximum_years is None:
        return True
    if profile_years is None:
        return (
            not requirement.get("source")
            or (minimum_years == 0.0 and maximum_years is None)
            or (
                job_fresher
                and minimum_years == 0.0
                and maximum_years == 2.0
            )
        )

    if tolerance is None:
        inferred_fresher_range = (
            job_fresher
            and minimum_years == 0.0
            and maximum_years == 2.0
        )
        if inferred_fresher_range:
            tolerance = 0.0
        elif minimum_years is not None and maximum_years is not None:
            tolerance = max(
                1.0,
                min(2.0, math.ceil((maximum_years - minimum_years) / 2.0)),
            )
        elif minimum_years is not None:
            tolerance = max(1.0, min(2.0, math.ceil(minimum_years / 3.0)))
        elif maximum_years is not None:
            tolerance = max(1.0, min(2.0, math.ceil(maximum_years / 3.0)))
        else:
            tolerance = 0.0

    gap = 0.0
    if minimum_years is not None and profile_years < minimum_years:
        gap = minimum_years - profile_years
    elif maximum_years is not None and profile_years > maximum_years:
        gap = profile_years - maximum_years
    return gap <= tolerance


# ============================================================
# OTHER FIT
# ============================================================

def other_fit(
    profile: Dict[str, Any],
    job: Dict[str, Any],
) -> float:

    values = [
        ProfileReader.bio(profile),
        ProfileReader.projects(profile),
        ProfileReader.education(profile),
        ProfileReader.certifications(profile),
        ProfileReader.achievements(profile),
        ProfileReader.industry(profile),
    ]

    job_text = job_search_text(
        job
    )

    scores = []

    for value in values:

        value = clean_text(
            value
        )

        if not value:
            continue

        if phrase_match(
            value,
            job_text,
        ):
            scores.append(
                100.0
            )
        else:
            scores.append(
                token_coverage(
                    value,
                    job_text,
                )
            )

    if not scores:
        return 0.0

    return clamp(
        sum(scores)
        / len(scores)
    )


# ============================================================
# MATCH SINGLE JOB
# ============================================================

def match_single_job(
    job: Dict[str, Any],
    profile: Dict[str, Any],
    search_term: str,
    embeddings: EmbeddingEngine,
) -> Dict[str, Any]:

    result = dict(
        job
    )

    query = clean_text(
        search_term
    )

    profile_role = (
        ProfileReader.target_role(
            profile
        )
    )
    profile_roles = ProfileReader.target_roles(profile)
    profile_context = ProfileReader.resume_context(profile)

    profile_skills = (
        ProfileReader.skills(
            profile
        )
    )
    profile_experience_years = _profile_years(profile)
    experience_requirement = job_experience_requirement(job)
    experience_match_details = {
        "requiredMinYears": experience_requirement["min_years"],
        "requiredMaxYears": experience_requirement["max_years"],
        "requiredLabel": experience_requirement_label(experience_requirement),
        "profileYears": profile_experience_years,
        "source": experience_requirement["source"],
        "matched": None,
    }

    # ========================================================
    # SEARCH
    # ========================================================

    search = search_match(
        query,
        job,
        embeddings,
    )

    # Search is its own relevance system, but a profile-driven recommendation
    # should not be discarded just because the literal search query is sparse.
    # For example, a search for "ml" should still allow a profile-targeted
    # role match to surface a Machine Learning Engineer internship.
    if query and not search[
        "relevant"
    ] and not (profile_roles or profile_role):

        result.update(
            {
                "searchRelevant": False,
                "roleRelevant": False,
                "searchMatchPercentage":
                    round(
                        search["score"],
                        2,
                    ),
                "roleMatchPercentage": 0.0,
                "skillMatchPercentage": 0.0,
                "experienceMatchPercentage": 0.0,
                "profileMatchPercentage": 0.0,
                "finalRankingScore": 0.0,
                "matchScore": 0.0,
            }
        )

        return result

    # ========================================================
    # ROLE / TITLE MATCH
    # ========================================================
    #
    # When searching (query is present):
    #   The search query defines the target role/topic (e.g. "ml", "nurse", "accountant").
    #   We evaluate role alignment against the search query, NOT penalizing it
    #   for not matching the profile's target role.
    #
    # When not searching (Dashboard mode):
    #   The user's profile target role is the anchor.
    # ========================================================

    # The profile role is the recommendation eligibility anchor even while a
    # search term is present. A user query must not turn a different occupation
    # into a personalized recommendation.
    role_candidates = profile_roles or ([query] if query else [])
    if not role_candidates:
        role_candidates = [profile_role]
    role = max(
        (
            profile_role_match(candidate, job, embeddings)
            for candidate in role_candidates
            if candidate
        ),
        key=lambda item: item["score"],
        default=profile_role_match(profile_role or query or "", job, embeddings),
    )

    # ========================================================
    # SKILLS
    # ========================================================

    skills = skill_match(
        profile_skills,
        job,
    )
    profile_semantic = (
        embeddings.similarity(
            profile_context,
            job_search_text(job)[:MAX_CONTEXT_CHARS],
        )
        if profile_context
        else 0.0
    )

    # ========================================================
    # EXPERIENCE
    # ========================================================

    experience_score = experience_match(
        ProfileReader.experience(
            profile
        ),
        job,
        profile=profile,
    )
    if profile_experience_years is not None and (
        experience_requirement["min_years"] is not None
        or experience_requirement["max_years"] is not None
    ):
        minimum_years = experience_requirement["min_years"]
        maximum_years = experience_requirement["max_years"]
        experience_gap = 0.0
        if minimum_years is not None and profile_experience_years < minimum_years:
            experience_gap = minimum_years - profile_experience_years
        elif maximum_years is not None and profile_experience_years > maximum_years:
            experience_gap = profile_experience_years - maximum_years
        experience_match_details["matched"] = experience_gap == 0.0

    # ========================================================
    # OTHER FIT
    # ========================================================

    other_score = other_fit(
        profile,
        job,
    )

    # ========================================================
    # Score only profile evidence that is actually available. Resume similarity
    # must contribute to the ranking even when the resume has no parsed skills
    # or explicit target-role field.
    # ========================================================

    score_components = []
    if profile_experience_years is not None:
        score_components.append((experience_score, 0.30))
    if profile_roles:
        score_components.append((role["score"], 0.30))
    if profile_skills:
        score_components.append((skills["score"], 0.25))
    if profile_context:
        score_components.append((profile_semantic, 0.10))
    if any(
        (
            ProfileReader.bio(profile),
            ProfileReader.projects(profile),
            ProfileReader.education(profile),
            ProfileReader.certifications(profile),
            ProfileReader.achievements(profile),
            ProfileReader.industry(profile),
        )
    ):
        score_components.append((other_score, 0.05))

    available_weight = sum(weight for _, weight in score_components)
    final_score = (
        sum(score * weight for score, weight in score_components)
        / available_weight
        if available_weight
        else 0.0
    )

    # ========================================================
    # PROFILE RELEVANCE SIGNAL
    # ========================================================
    #
    # Keep this as an evidence signal for the UI; ranking remains continuous so
    # a wording mismatch or sparse resume cannot erase the entire result set.

    profile_relevant = True

    if profile_context:
        # Treat the resume as a whole: title alignment, multiple explicit
        # skill matches, or strong resume-to-job semantic evidence can each
        # support a recommendation. This prevents a wording mismatch in the
        # headline from discarding a suitable role before its requirements
        # are compared, while unrelated jobs still need real profile evidence.
        profile_relevant = bool(
            (profile_roles and role.get("relevant", False))
            or (
                profile_skills
                and len(skills.get("matched", [])) >= 1
            )
            or profile_semantic >= 80
        )

    # ========================================================
    # MATCH REASONS
    # ========================================================

    reasons = []

    if query:

        if search.get("company", 0.0) >= 50:

            reasons.append(
                "The searched term matches the hiring company."
            )

        elif search["title"] >= 50:

            reasons.append(
                "The searched term matches the job title."
            )

        elif search["skills"] >= 50:

            reasons.append(
                "The searched term matches the job skills or technologies."
            )

        elif search["requirements"] >= 50:

            reasons.append(
                "The searched term appears in the job requirements."
            )

        elif search["description"] >= 50:

            reasons.append(
                "The searched term appears in the job description."
            )

        elif search["semantic"] >= 70:

            reasons.append(
                "The job is semantically related to the search."
            )

    else:

        if role["score"] >= 70:

            reasons.append(
                "The job title strongly aligns with your target role."
            )

        elif role["score"] >= 40:

            reasons.append(
                "The job title shows meaningful alignment with your target role."
            )

        elif profile_semantic >= 64:
            reasons.append(
                "The job description aligns with experience and skills in your resume."
            )

    if skills["matched"]:

        reasons.append(
            "Matched profile skills: "
            + ", ".join(
                skills["matched"][:5]
            )
            + "."
        )

    if (
        skills["missing"]
        and skills["available"]
    ):

        reasons.append(
            "Listed job skills not found in your profile: "
            + ", ".join(
                skills["missing"][:5]
            )
            + "."
        )

    if experience_score >= 75:

        reasons.append(
            "The experience level is compatible with your profile."
        )
    elif experience_requirement["min_years"] is not None:
        reasons.append(
            "The job description requires "
            f"{experience_requirement_label(experience_requirement)}; "
            "your experience match is lower."
        )

    if not reasons:

        reasons.append(
            "The job contains relevant matching evidence."
        )

    # ========================================================
    # OUTPUT
    # ========================================================

    result.update(
        {
            "searchRelevant": True,

            "profileRelevant":
                profile_relevant,

            "roleRelevant":
                role["relevant"],

            "searchMatchPercentage":
                round(
                    search["score"],
                    2,
                ),

            "roleMatchPercentage":
                round(
                    role["score"],
                    2,
                ),

            "skillMatchPercentage":
                round(
                    skills["score"],
                    2,
                ),

            "experienceMatchPercentage":
                round(
                    experience_score,
                    2,
                ),

            "otherFitPercentage":
                round(
                    other_score,
                    2,
                ),

            "semanticProfilePercentage":
                round(profile_semantic, 2),

            "profileMatchPercentage":
                round(
                    clamp(
                        final_score
                    ),
                    2,
                ),

            "finalRankingScore":
                round(
                    clamp(
                        final_score
                    ),
                    2,
                ),

            "matchScore":
                round(
                    clamp(
                        final_score
                    ),
                    2,
                ),

            "matchedSkills":
                skills["matched"],

            "missingSkills":
                skills["missing"],

            "detectedJobSkills":
                job_skills(job),

            "skillRequirementsAvailable":
                skills["available"],

            "profileSkillsAvailable":
                skills["profileAvailable"],

            "experienceDataAvailable":
                profile_experience_years is not None,

            "experienceMatch":
                experience_match_details,

            "matchReasons":
                reasons[:8],

            "rankingBreakdown":
                {
                    "experience":
                        round(
                            experience_score,
                            2,
                        ),

                    "roleTitle":
                        round(
                            role["score"],
                            2,
                        ),

                    "skills":
                        round(
                            skills["score"],
                            2,
                        ),

                    "otherFit":
                        round(
                            other_score,
                            2,
                        ),

                    "resumeSemantic":
                        round(profile_semantic, 2),
                },

            "searchEvidence":
                search,

            "roleEvidence":
                role,
        }
    )

    return result


# ============================================================
# MATCHER
# ============================================================

class JobMatcher:

    def __init__(self):

        self.embedding_engine = (
            EmbeddingEngine()
        )

    def match_job(
        self,
        job: Dict[str, Any],
        profile: Optional[
            Dict[str, Any]
        ] = None,
        search_term: str = "",
    ) -> Dict[str, Any]:

        return match_single_job(
            job=job,
            profile=profile or {},
            search_term=search_term,
            embeddings=self.embedding_engine,
        )

    def rank_jobs(
        self,
        jobs: Sequence[
            Dict[str, Any]
        ],
        profile: Optional[
            Dict[str, Any]
        ] = None,
        search_term: str = "",
    ) -> List[
        Dict[str, Any]
    ]:

        profile = profile or {}

        valid_jobs = [
            job
            for job in jobs
            if isinstance(
                job,
                dict,
            )
        ]

        if not valid_jobs:
            logger.info(
                "MATCHER | jobs=0"
            )
            return []

        query = clean_text(
            search_term
        )

        logger.info(
            "MATCHER | jobs=%d | query=%r | profile_role=%r",
            len(valid_jobs),
            query,
            ProfileReader.target_role(
                profile
            ),
        )

        # ====================================================
        # DO NOT DROP JOBS BEFORE FULL MATCHING
        # ====================================================
        #
        # This is important for searches like "ml".
        #
        # A cheap lexical pre-filter could throw away:
        #
        # "Machine Learning Engineer"
        #
        # because the literal token "ml" does not occur.
        #
        # Therefore the complete hard-filtered pool is ranked.
        # ====================================================

        jobs_to_rank = valid_jobs

        # ====================================================
        # PRELOAD EMBEDDINGS
        # ====================================================

        preload = []

        target_role = (
            ProfileReader.target_role(
                profile
            )
        )
        profile_role = target_role

        if query:
            preload.append(
                query
            )

        if target_role:
            preload.append(
                target_role
            )

        preload.append(
            ProfileReader.resume_context(profile)
        )

        for job in jobs_to_rank:
            title = job_title(job)
            if title:
                preload.append(title)
            context = job_search_text(job)[:400]
            if context:
                preload.append(context)

        self.embedding_engine.preload(
            preload
        )

        # ====================================================
        # FULL MATCH
        # ====================================================

        results = []

        for job in jobs_to_rank:

            matched = self.match_job(
                job=job,
                profile=profile,
                search_term=query,
            )

            if not matched:
                continue

            if query:
                if not matched.get(
                    "searchRelevant",
                    False,
                ):
                    continue
            elif not matched.get(
                "profileRelevant",
                False,
            ):
                continue

            results.append(
                matched
            )

        # ====================================================
        # SORT
        # ====================================================

        results.sort(
            key=lambda item: (
                safe_float(
                    item.get(
                        "searchMatchPercentage",
                        0.0,
                    )
                ) if query else 0.0,

                safe_float(
                    item.get(
                        "finalRankingScore",
                        0.0,
                    )
                ),

                safe_float(
                    item.get(
                        "searchMatchPercentage",
                        0.0,
                    )
                ),

                safe_float(
                    item.get(
                        "roleMatchPercentage",
                        0.0,
                    )
                ),

                safe_float(
                    item.get(
                        "skillMatchPercentage",
                        0.0,
                    )
                ),

                safe_float(
                    item.get(
                        "experienceMatchPercentage",
                        0.0,
                    )
                ),
            ),
            reverse=True,
        )

        logger.info(
            "MATCHER | final relevant jobs=%d",
            len(results),
        )

        return results


# ============================================================
# SINGLETON
# ============================================================

matcher = JobMatcher()
