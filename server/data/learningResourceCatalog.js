const resourceCatalog = [
  { keys: ["machine learning", "ml"], resources: [
    { title: "Machine Learning Crash Course", provider: "Google", url: "https://developers.google.com/machine-learning/crash-course", type: "Interactive course" },
    { title: "Intro to Machine Learning", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/intro-to-machine-learning", type: "Hands-on course" }
  ]},
  { keys: ["statistics", "probability", "statistics and probability"], resources: [
    { title: "Statistics and Probability", provider: "Khan Academy", url: "https://www.khanacademy.org/math/statistics-probability", type: "Guided lessons and exercises" },
    { title: "StatQuest", provider: "StatQuest", url: "https://www.youtube.com/@statquest", type: "Video lessons" }
  ]},
  { keys: ["tensorflow"], resources: [
    { title: "TensorFlow Fundamentals", provider: "Microsoft Learn", url: "https://learn.microsoft.com/en-us/training/paths/tensorflow-fundamentals/", type: "Guided learning path" },
    { title: "TensorFlow Beginner Quickstart", provider: "TensorFlow", url: "https://www.tensorflow.org/tutorials/quickstart/beginner", type: "Run a model in Google Colab" }
  ]},
  { keys: ["pytorch"], resources: [
    { title: "Learn the Basics", provider: "PyTorch", url: "https://pytorch.org/tutorials/beginner/basics/intro.html", type: "Step-by-step practical tutorial" },
    { title: "PyTorch YouTube Series", provider: "PyTorch", url: "https://pytorch.org/tutorials/beginner/introyt/introyt_index.html", type: "Video lessons" }
  ]},
  { keys: ["deep learning"], resources: [
    { title: "Practical Deep Learning for Coders", provider: "fast.ai", url: "https://course.fast.ai/", type: "Project-based course" },
    { title: "Deep Learning with PyTorch", provider: "PyTorch", url: "https://pytorch.org/tutorials/beginner/basics/intro.html", type: "Hands-on tutorial" }
  ]},
  { keys: ["python"], resources: [
    { title: "Python", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/python", type: "Hands-on micro-course" },
    { title: "Scientific Computing with Python", provider: "freeCodeCamp", url: "https://www.freecodecamp.org/learn/scientific-computing-with-python/", type: "Project-based course" }
  ]},
  { keys: ["sql", "mysql", "postgresql", "sqlite"], resources: [
    { title: "SQLBolt", provider: "SQLBolt", url: "https://sqlbolt.com/", type: "Interactive SQL lessons" },
    { title: "SQL Tutorial", provider: "Mode", url: "https://mode.com/sql-tutorial/", type: "Practical SQL tutorial" }
  ]},
  { keys: ["react", "react.js"], resources: [
    { title: "Learn React", provider: "Scrimba", url: "https://scrimba.com/learn/learnreact", type: "Interactive coding course" },
    { title: "React Tic-Tac-Toe Tutorial", provider: "React", url: "https://react.dev/learn/tutorial-tic-tac-toe", type: "Build-along project" }
  ]},
  { keys: ["node.js", "nodejs", "express.js", "express"], resources: [
    { title: "Back End Development and APIs", provider: "freeCodeCamp", url: "https://www.freecodecamp.org/learn/back-end-development-and-apis/", type: "Project-based course" },
    { title: "Node.js Getting Started", provider: "Node.js", url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs", type: "Guided practical lessons" }
  ]},
  { keys: ["java"], resources: [
    { title: "Java Programming", provider: "University of Helsinki", url: "https://java-programming.mooc.fi/", type: "Programming course with exercises" },
    { title: "Dev.java Learn", provider: "Oracle", url: "https://dev.java/learn/", type: "Guided tutorials" }
  ]},
  { keys: ["pandas"], resources: [
    { title: "Pandas", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/pandas", type: "Hands-on micro-course" },
    { title: "Pandas Getting Started", provider: "Pandas", url: "https://pandas.pydata.org/docs/getting_started/intro_tutorials/", type: "Practical data exercises" }
  ]},
  { keys: ["numpy"], resources: [
    { title: "NumPy Learn", provider: "NumPy", url: "https://numpy.org/learn/", type: "Guided tutorials" },
    { title: "Python", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/python", type: "Hands-on micro-course" }
  ]},
  { keys: ["nlp", "natural language processing"], resources: [
    { title: "NLP Course", provider: "Hugging Face", url: "https://huggingface.co/learn/nlp-course/chapter1/1", type: "Practical course with notebooks" },
    { title: "Intro to NLP", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/intro-to-nlp", type: "Hands-on micro-course" }
  ]},
  { keys: ["computer vision"], resources: [
    { title: "Computer Vision", provider: "Kaggle Learn", url: "https://www.kaggle.com/learn/computer-vision", type: "Hands-on micro-course" },
    { title: "Practical Deep Learning for Coders", provider: "fast.ai", url: "https://course.fast.ai/", type: "Project-based course" }
  ]},
  { keys: ["docker"], resources: [
    { title: "Docker for Beginners", provider: "Play with Docker", url: "https://training.play-with-docker.com/", type: "Interactive hands-on labs" },
    { title: "Docker Getting Started", provider: "Docker", url: "https://docs.docker.com/get-started/", type: "Build-and-run tutorial" }
  ]},
  { keys: ["aws", "amazon web services"], resources: [
    { title: "AWS Skill Builder", provider: "Amazon Web Services", url: "https://skillbuilder.aws/", type: "Guided digital courses and labs" },
    { title: "AWS Workshops", provider: "Amazon Web Services", url: "https://workshops.aws/", type: "Step-by-step practical workshops" }
  ]},
  { keys: ["git", "github"], resources: [
    { title: "Learn Git Branching", provider: "Learn Git Branching", url: "https://learngitbranching.js.org/", type: "Interactive Git challenges" },
    { title: "GitHub Skills", provider: "GitHub", url: "https://skills.github.com/", type: "Hands-on GitHub projects" }
  ]},
  { keys: ["data structures", "algorithms"], resources: [
    { title: "VisuAlgo", provider: "VisuAlgo", url: "https://visualgo.net/en", type: "Interactive algorithm visualisations" },
    { title: "Problem Solving", provider: "HackerRank", url: "https://www.hackerrank.com/domains/algorithms", type: "Coding practice challenges" }
  ]},
  { keys: ["power bi"], resources: [
    { title: "Get Started with Power BI", provider: "Microsoft Learn", url: "https://learn.microsoft.com/en-us/training/powerplatform/power-bi", type: "Guided learning path" },
    { title: "Power BI Sample Data", provider: "Microsoft", url: "https://learn.microsoft.com/en-us/power-bi/create-reports/sample-datasets", type: "Practice with datasets" }
  ]},
  { keys: ["selenium", "software testing", "test automation"], resources: [
    { title: "Selenium Getting Started", provider: "Selenium", url: "https://www.selenium.dev/documentation/webdriver/getting_started/", type: "Build browser automation" },
    { title: "Test Automation University", provider: "Applitools", url: "https://testautomationu.applitools.com/", type: "Free practical courses" }
  ]},
  { keys: ["kubernetes"], resources: [
    { title: "Kubernetes Basics", provider: "Kubernetes", url: "https://kubernetes.io/docs/tutorials/kubernetes-basics/", type: "Interactive guided tutorial" },
    { title: "Kubernetes Tutorials", provider: "Kubernetes", url: "https://kubernetes.io/docs/tutorials/", type: "Hands-on tutorials" }
  ]}
];

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();

const getLearningResources = (skill) => {
  const key = normalize(skill);
  const match = resourceCatalog.find((entry) => entry.keys.some((alias) => normalize(alias) === key));
  if (match) return match.resources;
  const query = encodeURIComponent(skill + " practical course with exercises");
  return [
    { title: skill + " - guided course finder", provider: "Coursera", url: "https://www.coursera.org/search?query=" + query, type: "Course search" },
    { title: skill + " - practical video lessons", provider: "YouTube", url: "https://www.youtube.com/results?search_query=" + query, type: "Video lessons search" }
  ];
};

module.exports = { getLearningResources };
