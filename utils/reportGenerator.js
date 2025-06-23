import fs from "fs"
import PDFDocument from "pdfkit"
import csv from "csv-parser"
import path from "path"

class ReportGenerator {
  constructor(csvPath) {
    this.csvPath = csvPath
    this.data = []
    this.d3 = null
  }

  async readCSV() {
    // Check if file exists first
    if (!fs.existsSync(this.csvPath)) {
      throw new Error(`CSV file not found at path: ${this.csvPath}`)
    }

    return new Promise((resolve, reject) => {
      const results = []
      fs.createReadStream(this.csvPath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => {
          if (results.length === 0) {
            reject(new Error("CSV file is empty"))
          } else {
            resolve(results)
          }
        })
        .on("error", (error) => reject(error))
    })
  }

  async initialize() {
    try {
      this.d3 = await import("d3-array")
    } catch (error) {
      console.error("Error loading d3-array:", error)
      throw error
    }
  }

  async generateAnalysis() {
    try {
      const responses = await this.readCSV()
      const departments = [...new Set(responses.map((r) => r["Department"]))]

      // Create a comprehensive question map to ensure no questions are missed
      const allQuestionsMap = new Map()

      // First pass: collect ALL unique questions and their answer patterns
      const questionAnswerMap = new Map()

      responses.forEach((response) => {
        Object.keys(response).forEach((key) => {
          if (key.startsWith("Question")) {
            const qNum = key.split(" ")[1]
            const question = response[key]
            const answerKey = `Answer ${qNum}`
            const answer = response[answerKey]
            
            if (question && question.trim()) {
              allQuestionsMap.set(qNum, question)
              
              // Collect all answers for this question to determine type
              if (!questionAnswerMap.has(qNum)) {
                questionAnswerMap.set(qNum, [])
              }
              if (answer && answer !== "No answer") {
                questionAnswerMap.get(qNum).push(answer)
              }
            }
          }
        })
      })

      // Calculate overall satisfaction metrics
      const overallMetrics = this.calculateSatisfactionPercentage(responses)

      // Process department-wise statistics
      let highestDissatisfactionDept = ""
      let highestDissatisfactionRate = 0

      departments.forEach((dept) => {
        const deptResponses = responses.filter((r) => r["Department"] === dept)
        const deptMetrics = this.calculateSatisfactionPercentage(deptResponses)

        if (deptMetrics.dissatisfaction > highestDissatisfactionRate) {
          highestDissatisfactionRate = deptMetrics.dissatisfaction
          highestDissatisfactionDept = dept
        }
      })

      const analysis = {
        overview: {
          numberOfDepartments: departments.length,
          averageSatisfaction: `${overallMetrics.satisfaction}%`,
          averageDissatisfaction: `${overallMetrics.dissatisfaction}%`,
          departmentWithHighestDissatisfaction: highestDissatisfactionDept || "None",
          highestDissatisfactionRate: highestDissatisfactionRate,
          totalQuestions: allQuestionsMap.size,
          totalResponses: responses.length,
        },
        departmentStats: {},
        questionAnalysis: {},
      }

      // Process each department
      departments.forEach((dept) => {
        const deptResponses = responses.filter((r) => r["Department"] === dept)
        const questionAnalysis = {}

        // Process each question for this department
        allQuestionsMap.forEach((question, qNum) => {
          const allAnswersForQuestion = questionAnswerMap.get(qNum) || []
          const questionType = this.determineQuestionType(allAnswersForQuestion[0], allAnswersForQuestion)

          questionAnalysis[qNum] = {
            question: question,
            responses: {},
            responseCount: 0,
            type: questionType,
            allOptions: this.extractAllOptions(allAnswersForQuestion, questionType),
          }

          // Process responses for this question in this department
          deptResponses.forEach((response) => {
            const answerKey = `Answer ${qNum}`
            const answer = response[answerKey]

            if (!answer || answer === "No answer") return

            if (questionType === "StarRating") {
              const starValue = answer.toString().trim()
              if (/^[1-5]$/.test(starValue)) {
                questionAnalysis[qNum].responses[starValue] = (questionAnalysis[qNum].responses[starValue] || 0) + 1
              }
            } else if (questionType === "Checkbox") {
              const options = answer.split(",").map((opt) => opt.trim())
              options.forEach((opt) => {
                questionAnalysis[qNum].responses[opt] = (questionAnalysis[qNum].responses[opt] || 0) + 1
              })
            } else {
              // For MCQ and Text, count each response
              questionAnalysis[qNum].responses[answer] = (questionAnalysis[qNum].responses[answer] || 0) + 1
            }
            questionAnalysis[qNum].responseCount++
          })
        })

        analysis.departmentStats[dept] = {
          questionAnalysis: questionAnalysis,
          responseCount: deptResponses.length,
        }
      })

      // Create comprehensive question analysis across all departments
      allQuestionsMap.forEach((question, qNum) => {
        const allAnswersForQuestion = questionAnswerMap.get(qNum) || []
        const questionType = this.determineQuestionType(allAnswersForQuestion[0], allAnswersForQuestion)

        const questionData = {
          question: question,
          type: questionType,
          departmentResponses: new Map(),
          totalResponses: 0,
          allOptions: this.extractAllOptions(allAnswersForQuestion, questionType),
        }

        departments.forEach((dept) => {
          if (analysis.departmentStats[dept] && analysis.departmentStats[dept].questionAnalysis[qNum]) {
            const deptQuestionData = analysis.departmentStats[dept].questionAnalysis[qNum]
            questionData.departmentResponses.set(dept, deptQuestionData)
            questionData.totalResponses += deptQuestionData.responseCount
          }
        })

        analysis.questionAnalysis[qNum] = questionData
      })

      return analysis
    } catch (error) {
      console.error("Analysis generation error:", error)
      throw error
    }
  }

  // Enhanced PDF generation with only Question Analysis section and visualizations
  async generatePDF(analysis) {
    try {
      // Validate analysis object
      if (!analysis) {
        analysis = await this.generateAnalysis()
      }

      const doc = new PDFDocument({
        autoFirstPage: true,
        size: "A4",
        margin: 80,
        info: {
          Title: "Survey Question Analysis Report",
          Author: "Survey Analysis System",
          Subject: "Comprehensive Question Analysis",
          Keywords: "survey, analysis, questions, responses",
        },
      })

      const outputPath = path.join(path.dirname(this.csvPath), "..", "reports", "survey_analysis.pdf")

      // Ensure reports directory exists
      const reportsDir = path.dirname(outputPath)
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true })
      }

      const stream = fs.createWriteStream(outputPath)
      doc.pipe(stream)

      // Cover page with enhanced design
      doc.fontSize(32).fillColor("#253074").text("Survey Question Analysis Report", { align: "center" })
      doc.moveDown()
      doc
        .fontSize(16)
        .fillColor("#666666")
        .text(`Generated on: ${new Date().toLocaleDateString()}`, { align: "center" })
      doc.text(`Departments Covered: ${analysis.overview.numberOfDepartments}`, { align: "center" })
      doc.moveDown(2)

      // Add decorative border
      doc
        .lineWidth(3)
        .strokeColor("#253074")
        .rect(50, 50, doc.page.width - 100, doc.page.height - 100)
        .stroke()

      doc.addPage()

      // Question Analysis Section - Enhanced with visualizations
      doc.fontSize(24).fillColor("#253074").text("Question Analysis", { align: "center" })
      doc.moveDown(2)

      // Add summary statistics box
      this.addSummaryBox(doc, analysis)
      doc.addPage()

      // Process each question with enhanced analysis
      const questionEntries = Object.entries(analysis.questionAnalysis)
      let questionIndex = 1

      for (const [qNum, questionInfo] of questionEntries) {
        // Question header with styling
        doc.fontSize(16).fillColor("#253074").text(`Question ${questionIndex}: ${questionInfo.question}`)
        doc
          .fontSize(12)
          .fillColor("#666666")
          .text(`Question Type: ${questionInfo.type} | Total Responses: ${questionInfo.totalResponses}`)
        doc.moveDown(0.5)

        // Add visual separator
        doc
          .lineWidth(1)
          .strokeColor("#cccccc")
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .stroke()
        doc.moveDown(0.5)

        // Department-wise analysis with enhanced formatting
        if (questionInfo.type === "MCQ" || questionInfo.type === "Checkbox" || questionInfo.type === "StarRating") {
          this.renderQuestionWithVisualization(doc, questionInfo, questionIndex)
        } else if (questionInfo.type === "Text") {
          this.renderTextQuestionAnalysis(doc, questionInfo)
        }

        doc.moveDown(1.5)
        questionIndex++

        // Add page break if needed
        if (doc.y > 650) {
          doc.addPage()
        }
      }

      // Add insights and recommendations page
      doc.addPage()
      this.addInsightsPage(doc, analysis)

      doc.end()

      return new Promise((resolve, reject) => {
        stream.on("finish", () => resolve(outputPath))
        stream.on("error", reject)
      })
    } catch (error) {
      console.error("PDF Generation Error:", error)
      throw new Error(`Failed to generate PDF: ${error.message}`)
    }
  }

  // Add summary statistics box
  addSummaryBox(doc, analysis) {
    const boxY = doc.y
    const boxHeight = 120

    // Draw summary box
    doc.rect(50, boxY, doc.page.width - 100, boxHeight).fillAndStroke("#f8f9fa", "#253074")

    doc
      .fontSize(14)
      .fillColor("#253074")
      .text("Survey Overview", 70, boxY + 15)
    doc
      .fontSize(11)
      .fillColor("#333333")
      .text(`• Total Questions: ${analysis.overview.totalQuestions}`, 70, boxY + 35)
      .text(`• Total Responses: ${analysis.overview.totalResponses}`, 70, boxY + 50)
      .text(`• Departments: ${analysis.overview.numberOfDepartments}`, 70, boxY + 65)
      .text(`• Overall Satisfaction: ${analysis.overview.averageSatisfaction}`, 70, boxY + 80)
      .text(
        `• Department with Highest Dissatisfaction: ${analysis.overview.departmentWithHighestDissatisfaction}`,
        70,
        boxY + 95,
      )

    doc.y = boxY + boxHeight + 20
  }

  // Enhanced question rendering with proper option counting
  renderQuestionWithVisualization(doc, questionInfo, questionIndex) {
    questionInfo.departmentResponses.forEach((qData, dept) => {
      doc.fontSize(13).fillColor("#253074").text(`${dept} Department:`)
      doc.fontSize(11).fillColor("#333333")

      if (questionInfo.type === "StarRating") {
        this.renderStarRatingCounts(doc, qData.responses, questionInfo.allOptions)
      } else if (questionInfo.type === "MCQ") {
        this.renderMCQCounts(doc, qData.responses, questionInfo.allOptions)
      } else if (questionInfo.type === "Checkbox") {
        this.renderCheckboxCounts(doc, qData.responses, questionInfo.allOptions)
      }

      doc.moveDown(0.5)
    })
  }

  // Enhanced text question analysis
  renderTextQuestionAnalysis(doc, questionInfo) {
    questionInfo.departmentResponses.forEach((qData, dept) => {
      doc.fontSize(13).fillColor("#253074").text(`${dept} Department:`)
      doc.fontSize(10).fillColor("#333333")

      const responses = Object.keys(qData.responses).slice(0, 5) // Show top 5 responses
      responses.forEach((response, index) => {
        if (response && response !== "No answer") {
          const truncatedResponse = response.length > 80 ? response.substring(0, 80) + "..." : response
          doc.text(`${index + 1}. "${truncatedResponse}"`, 70, doc.y)
          doc.moveDown(0.3)
        }
      })

      if (Object.keys(qData.responses).length > 5) {
        doc.text(`... and ${Object.keys(qData.responses).length - 5} more responses`, 70, doc.y)
      }

      doc.moveDown(0.5)
    })
  }

  // Add insights and recommendations page
  addInsightsPage(doc, analysis) {
    doc.fontSize(20).fillColor("#253074").text("Key Insights & Recommendations", { align: "center" })
    doc.moveDown(2)

    // Generate insights based on analysis
    const insights = this.generateInsights(analysis)

    doc.fontSize(16).fillColor("#253074").text("Key Findings:")
    doc.moveDown(0.5)

    insights.findings.forEach((finding, index) => {
      doc
        .fontSize(12)
        .fillColor("#333333")
        .text(`${index + 1}. ${finding}`, { indent: 20 })
      doc.moveDown(0.3)
    })

    doc.moveDown(1)
    doc.fontSize(16).fillColor("#253074").text("Recommendations:")
    doc.moveDown(0.5)

    insights.recommendations.forEach((recommendation, index) => {
      doc
        .fontSize(12)
        .fillColor("#333333")
        .text(`${index + 1}. ${recommendation}`, { indent: 20 })
      doc.moveDown(0.3)
    })
  }

  // Generate insights from analysis data
  generateInsights(analysis) {
    const findings = []
    const recommendations = []

    // Analyze satisfaction levels
    const satisfactionRate = Number.parseFloat(analysis.overview.averageSatisfaction.replace("%", ""))
    if (satisfactionRate > 80) {
      findings.push("Overall satisfaction levels are excellent across the organization.")
    } else if (satisfactionRate > 60) {
      findings.push("Satisfaction levels are moderate with room for improvement.")
    } else {
      findings.push("Satisfaction levels are below expectations and require immediate attention.")
    }

    // Department-specific insights
    if (analysis.overview.departmentWithHighestDissatisfaction !== "None") {
      findings.push(
        `${analysis.overview.departmentWithHighestDissatisfaction} department shows the highest dissatisfaction rate.`,
      )
      recommendations.push(
        `Focus improvement initiatives on ${analysis.overview.departmentWithHighestDissatisfaction} department.`,
      )
    }

    // Question coverage insights
    findings.push(
      `Analysis covers ${analysis.overview.totalQuestions} questions across ${analysis.overview.numberOfDepartments} departments.`,
    )

    // General recommendations
    recommendations.push("Conduct follow-up surveys to track improvement progress.")
    recommendations.push("Implement department-specific action plans based on feedback.")
    recommendations.push("Regular monitoring of satisfaction metrics is recommended.")

    return { findings, recommendations }
  }

  // Helper methods remain the same
  calculateSatisfactionPercentage(responses) {
    let satisfactionScore = 0
    let dissatisfactionScore = 0
    let satisfactionQuestions = 0
    let dissatisfactionQuestions = 0

    responses.forEach((response) => {
      Object.keys(response).forEach((key) => {
        if (key.startsWith("Answer")) {
          const answer = response[key]
          const questionKey = `Question ${key.split(" ")[1]}`
          const question = response[questionKey]

          if (!answer || !question) return

          // Handle star ratings
          const starMatch = answer.match(/(\d+)\s*stars?/i)
          if (starMatch) {
            const stars = Number.parseInt(starMatch[1])
            if (!isNaN(stars)) {
              if (stars >= 3) {
                satisfactionScore += (stars / 5) * 100
                satisfactionQuestions++
              } else {
                dissatisfactionScore += ((5 - stars) / 5) * 100
                dissatisfactionQuestions++
              }
            }
          }
          // Handle satisfaction-based responses
          else {
            const satisfactionLevels = {
              "Very Satisfied": 100,
              Satisfied: 75,
              Neutral: 50,
              Dissatisfied: 25,
              "Very Dissatisfied": 0,
            }

            const answerKey = answer.trim()
            if (satisfactionLevels.hasOwnProperty(answerKey)) {
              if (["Very Satisfied", "Satisfied"].includes(answerKey)) {
                satisfactionScore += satisfactionLevels[answerKey]
                satisfactionQuestions++
              } else if (["Dissatisfied", "Very Dissatisfied"].includes(answerKey)) {
                dissatisfactionScore += 100 - satisfactionLevels[answerKey]
                dissatisfactionQuestions++
              }
            }
          }
        }
      })
    })

    return {
      satisfaction: satisfactionQuestions > 0 ? Math.round(satisfactionScore / satisfactionQuestions) : 0,
      dissatisfaction: dissatisfactionQuestions > 0 ? Math.round(dissatisfactionScore / dissatisfactionQuestions) : 0,
    }
  }

  // Enhanced question type detection with better logic
  determineQuestionType(answer, allAnswers = []) {
    if (!answer) return "Text"

    // Check if it's a star rating (numbers 1-5 or contains "stars")
    if (/^[1-5]$/.test(answer.toString().trim()) || answer.match(/(\d+)\s*stars?/i)) {
      return "StarRating"
    }

    // Check if it's a checkbox (contains comma)
    if (answer.includes(",")) {
      return "Checkbox"
    }

    // Check if it's MCQ (satisfaction levels or common MCQ options)
    const mcqOptions = [
      "Very Satisfied",
      "Satisfied",
      "Neutral",
      "Dissatisfied",
      "Very Dissatisfied",
      "Excellent",
      "Good",
      "Average",
      "Poor",
      "Very Poor",
      "Strongly Agree",
      "Agree",
      "Neutral",
      "Disagree",
      "Strongly Disagree",
      "Always",
      "Often",
      "Sometimes",
      "Rarely",
      "Never",
      "Yes",
      "No",
      "Maybe",
      "Continue",
      "Discontinue",
      "Modify",
      "NA",
    ]

    // Check if this answer or any answer in allAnswers matches MCQ pattern
    const answerTrimmed = answer.toString().trim()
    if (mcqOptions.includes(answerTrimmed)) {
      return "MCQ"
    }

    // Check if most answers in allAnswers are from MCQ options (for better detection)
    if (allAnswers && allAnswers.length > 0) {
      const mcqCount = allAnswers.filter((a) => a && mcqOptions.includes(a.toString().trim())).length
      if (mcqCount > allAnswers.length * 0.5) {
        // If more than 50% are MCQ options
        return "MCQ"
      }
    }

    // Default to text
    return "Text"
  }

  // Extract all possible options for a question based on its type
  extractAllOptions(allAnswers, questionType) {
    if (questionType === "StarRating") {
      return ["1", "2", "3", "4", "5"]
    } else if (questionType === "MCQ") {
      // Get unique options from all answers
      const uniqueOptions = [...new Set(allAnswers.filter((a) => a && a !== "No answer"))]
      return uniqueOptions.sort()
    } else if (questionType === "Checkbox") {
      // For checkbox, extract all individual options
      const allOptions = new Set()
      allAnswers.forEach((answer) => {
        if (answer && answer !== "No answer") {
          answer.split(",").forEach((opt) => allOptions.add(opt.trim()))
        }
      })
      return Array.from(allOptions).sort()
    }
    return []
  }

  // Render star rating with counts only
  renderStarRatingCounts(doc, responses, allOptions) {
    allOptions.forEach((option, index) => {
      const count = responses[option] || 0
      doc.text(`Option ${index + 1} (${option} Star${option > 1 ? "s" : ""}): ${count} responses`, 70, doc.y)
      doc.moveDown(0.3)
    })

    // Calculate and show average
    const totalResponses = Object.values(responses).reduce((sum, count) => sum + count, 0)
    const weightedSum = Object.entries(responses).reduce(
      (sum, [stars, count]) => sum + Number.parseInt(stars) * count,
      0,
    )
    const average = totalResponses > 0 ? (weightedSum / totalResponses).toFixed(1) : "0.0"

    doc
      .fontSize(10)
      .fillColor("#666666")
      .text(`Average Rating: ${average}/5.0 (${totalResponses} total responses)`, 70, doc.y)
    doc.moveDown(0.5)
  }

  // Render MCQ with counts
  renderMCQCounts(doc, responses, allOptions) {
    allOptions.forEach((option, index) => {
      const count = responses[option] || 0
      doc.text(`Option ${index + 1} (${option}): ${count} responses`, 70, doc.y)
      doc.moveDown(0.3)
    })

    // Calculate satisfaction percentage if applicable
    const satisfactionOptions = [
      "Very Satisfied",
      "Satisfied",
      "Excellent",
      "Good",
      "Strongly Agree",
      "Agree",
      "Always",
      "Often",
      "Yes",
      "Continue",
    ]
    const totalResponses = Object.values(responses).reduce((sum, count) => sum + count, 0)
    const positiveResponses = Object.entries(responses).reduce((sum, [option, count]) => {
      return satisfactionOptions.some((pos) => option.includes(pos)) ? sum + count : sum
    }, 0)

    if (totalResponses > 0 && positiveResponses > 0) {
      const positivePercentage = ((positiveResponses / totalResponses) * 100).toFixed(1)
      doc
        .fontSize(10)
        .fillColor("#666666")
        .text(`Positive Response Rate: ${positivePercentage}% (${totalResponses} total responses)`, 70, doc.y)
    } else {
      doc.fontSize(10).fillColor("#666666").text(`Total Responses: ${totalResponses}`, 70, doc.y)
    }
    doc.moveDown(0.5)
  }

  // Render checkbox with counts
  renderCheckboxCounts(doc, responses, allOptions) {
    allOptions.forEach((option, index) => {
      const count = responses[option] || 0
      doc.text(`Option ${index + 1} (${option}): ${count} responses`, 70, doc.y)
      doc.moveDown(0.3)
    })

    const totalSelections = Object.values(responses).reduce((sum, count) => sum + count, 0)
    doc.fontSize(10).fillColor("#666666").text(`Total Selections: ${totalSelections}`, 70, doc.y)
    doc.moveDown(0.5)
  }

  // Legacy methods for compatibility
  async analyze() {
    return await this.generateAnalysis()
  }

  calculateSatisfactionRate(responses) {
    let totalResponses = 0
    let satisfiedCount = 0

    responses.forEach((response) => {
      Object.values(response.answers || {}).forEach((answer) => {
        if (typeof answer === "string") {
          const lowerAnswer = answer.toLowerCase()
          if (lowerAnswer.includes("satisf") || lowerAnswer.includes("happy") || lowerAnswer.includes("good")) {
            totalResponses++

            if (
              !lowerAnswer.includes("not") &&
              !lowerAnswer.includes("dis") &&
              (lowerAnswer.includes("very satisf") ||
                lowerAnswer.includes("quite satisf") ||
                lowerAnswer.includes("very happy") ||
                lowerAnswer.includes("very good"))
            ) {
              satisfiedCount++
            }
          }
        }
      })
    })

    return totalResponses > 0 ? Math.round((satisfiedCount / totalResponses) * 100) : 0
  }
}

export default ReportGenerator
