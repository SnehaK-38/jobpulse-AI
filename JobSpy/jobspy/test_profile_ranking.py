import asyncio

from jobspy.matcher import profile_role_match
from jobspy.server import RankRequest, matcher as server_matcher, rank_jobs


class ResumeEmbeddings:
    def preload(self, texts):
        pass

    def similarity(self, left, right):
        if "sql" in right.lower() and "dashboard" in right.lower():
            return 95.0
        return 5.0


class WeakRoleSimilarity:
    def preload(self, texts):
        pass

    def similarity(self, left, right):
        return 84.0


def test_rank_recommendations_only_include_resume_relevant_jobs():
    profile = {
        "lookingFor": "Internship",
        "resumeText": "Analytics professional skilled in SQL and dashboard reporting.",
    }
    jobs = [
        {
            "title": "Analytics Intern",
            "jobType": "Internship",
            "description": "Build SQL dashboards and reports.",
        },
        {
            "title": "Finance Intern",
            "jobType": "Internship",
            "experience": "3 years",
            "description": "Assist with accounting reconciliations.",
        },
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    job_type="Internship",
                    location="Mumbai",
                    profile=profile,
                    jobs=[
                        {**job, "location": "Mumbai"}
                        for job in jobs
                    ],
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    ranked = response["jobs"]

    assert response["count"] == 1
    assert [job["title"] for job in ranked] == ["Analytics Intern"]
    assert ranked[0]["profileRelevant"] is True


def test_rank_keeps_jobs_matching_one_profile_skill():
    profile = {
        "skills": ["Python", "React"],
    }
    job = {
        "title": "Backend Developer",
        "description": "Build and maintain Python APIs.",
    }

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    profile=profile,
                    jobs=[job],
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert response["count"] == 1
    assert response["jobs"][0]["profileRelevant"] is True
    assert response["jobs"][0]["matchedSkills"] == ["Python"]


def test_rank_matches_software_engineer_profile_to_related_roles():
    profile = {
        "targetRole": "Software Engineer",
        "lookingFor": "Internship",
    }
    titles = [
        "Software Engineer Intern",
        "Full Stack Developer Intern",
        "Web Development Intern",
        "AI Agent Engineer Intern",
        "Forward-Deployed Engineer Intern",
        "PHP Developer Intern",
        ".NET Core Developer Intern",
        "MERN Stack Developer Intern",
        "Intern - Software Tester",
        "QA Intern (REST & Automation)",
        "Software Quality Assurance (QA) Intern",
        "AI Automation Intern",
        "Finance Intern",
        "GTM Engineer Intern",
        "Compliance Engineer Intern",
        "Enterprise Systems Intern",
        "Web Designer-Intern",
    ]
    jobs = [
        {
            "title": title,
            "jobType": "Internship",
            "location": "Mumbai",
        }
        for title in titles
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    job_type="Internship",
                    location="Mumbai",
                    profile=profile,
                    jobs=jobs,
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert [job["title"] for job in response["jobs"]] == [
        "Software Engineer Intern",
        "Full Stack Developer Intern",
        "Web Development Intern",
        "AI Agent Engineer Intern",
        "Forward-Deployed Engineer Intern",
        "PHP Developer Intern",
        ".NET Core Developer Intern",
        "MERN Stack Developer Intern",
        "Intern - Software Tester",
        "QA Intern (REST & Automation)",
        "Software Quality Assurance (QA) Intern",
        "AI Automation Intern",
    ]


def test_semantic_role_similarity_does_not_admit_weak_title_match():
    result = profile_role_match(
        "Software Engineer",
        {"title": "Web Designer-Intern"},
        WeakRoleSimilarity(),
    )

    assert result["relevant"] is False


def test_rank_deduplicates_same_job_with_different_urls():
    profile = {
        "targetRole": "Software Engineer",
        "lookingFor": "Internship",
    }
    jobs = [
        {
            "title": "Software Engineer Intern",
            "company": "Example Company",
            "location": "Mumbai",
            "jobType": "Internship",
            "jobUrl": f"https://example.test/{index}",
        }
        for index in range(2)
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    job_type="Internship",
                    location="Mumbai",
                    profile=profile,
                    jobs=jobs,
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert response["count"] == 1


def test_search_relevance_is_primary_rank_for_typed_search():
    profile = {
        "targetRole": "Senior Engineer",
        "lookingFor": "Full-Time",
        "experience": "Fresher",
    }
    jobs = [
        {
            "title": "Software Engineer",
            "jobType": "Full-Time",
            "location": "Mumbai",
        },
        {
            "title": "Senior Engineer",
            "jobType": "Full-Time",
            "location": "Mumbai",
        },
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    search_term="software engineer",
                    profile=profile,
                    jobs=jobs,
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert response["jobs"][0]["title"] == "Software Engineer"


def test_rank_returns_20_software_internships_when_candidates_exist():
    profile = {
        "targetRole": "SDE",
        "lookingFor": "Internship",
    }
    jobs = [
        {
            "title": f"Software Engineer Intern - Team {index}",
            "jobType": "Internship",
            "location": "Mumbai",
        }
        for index in range(20)
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    job_type="Internship",
                    location="Mumbai",
                    profile=profile,
                    jobs=jobs,
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert response["count"] == 20


def test_rank_does_not_fill_recommendations_with_unrelated_jobs():
    profile = {
        "targetRole": "Data Scientist",
        "skills": ["Python", "Machine Learning"],
    }
    jobs = [
        {
            "title": f"Operations Associate - Team {index}",
            "jobType": "Full-Time",
        }
        for index in range(60)
    ]

    previous_embeddings = server_matcher.embedding_engine
    server_matcher.embedding_engine = ResumeEmbeddings()
    try:
        response = asyncio.run(
            rank_jobs(
                RankRequest(
                    profile=profile,
                    jobs=jobs,
                )
            )
        )
    finally:
        server_matcher.embedding_engine = previous_embeddings

    assert response["count"] == 0
