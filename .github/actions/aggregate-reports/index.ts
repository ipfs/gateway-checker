import fs  from 'fs'
import process from 'process'
import path from 'path'
import { z } from "zod";

interface ReportOutput {
  metadata: {
    time: string
    version?: string
    job_url?: string
    gateway_url: string
  }
  results: {
    [key: string]: {
      pass: number
      fail: number
      skip: number
    }
  }
}

type GatewayURL = string

const Outcome = z.enum(['pass', 'fail', 'skip'])

const ReportFileInput = z.intersection(
  z.record(z.object({
    path: z.array(z.string()),
    time: z.string(),
    outcome: Outcome,
    output: z.string().optional(),
    meta: z.object({
      group: z.string().optional(),
    }).optional(),
  })),
  z.object({
    TestMetadata: z.object({
      time: z.string(),
      meta: z.object({
        version: z.string().optional(),
        job_url: z.string().optional(),
        gateway_url: z.string(),
      })
    }).optional(),
  })
)

/**
 * Processes a report from a given filePath and extracts important data.
 */
const processReport = (filePath: string): [GatewayURL, ReportOutput] => {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const reportContent = ReportFileInput.parse(JSON.parse(fs.readFileSync(resolvedPath, 'utf8')))

  // extract the TestMetadata
  const { TestMetadata, ...allOtherTests } = reportContent

  if (!TestMetadata) {
    throw new Error(`No TestMetadata found in ${resolvedPath}`)
  }

  const { time, meta } = TestMetadata
  const { version, job_url, gateway_url } = meta

  // Then extract the test results we care about.
  const groups = Object.entries(allOtherTests)
    .filter(([_, value]) => value.path.length === 1) // keep only the tests at the root
    .map(([_key, value]) => {
      // keep only the outcomes and groups
      return {
        outcome: value.outcome,
        group: value.meta?.group ?? 'Others',
      }
    })
    .reduce((acc, value) => {
      // then group by "group" value and sum their outcomes
      const { outcome, group } = value

      if (!acc[group]) {
        acc[group] = {
          pass: 0,
          fail: 0,
          skip: 0,
        }
      }

      acc[group][outcome] += 1

      return acc
    }, {} as { [key: string]: { pass: number, fail: number, skip: number } })

  return [
    gateway_url,
    {
      metadata: {
        time, version, job_url, gateway_url,
      },
      results: groups,
    },
  ]
}

/**
 * Main function to process all input files and write the results to standard output.
 */
const main = async (): Promise<void> => {
  const output: string = process.argv[2] // Output file path.
  const inputs: string[] = process.argv.slice(3) // List of json reports to aggregate.

  const results: {[key: string]: ReportOutput} = {}
  
  inputs.forEach((filePath) => {
    try {
      const [name, report] = processReport(filePath)
      results[name] = report
    } catch (err) {
      console.error(`Error processing ${filePath}`, err)
    }
  })

  fs.writeFileSync(output, JSON.stringify(results, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
