name := "playrtc"

organization := "com.github.atamborrino"

version := "0.1-SNAPSHOT"
 
scalaVersion := "2.10.2"
 
resolvers ++= Seq(
  "TypesafeRepo repository" at "http://repo.typesafe.com/typesafe/releases/"
)
 
libraryDependencies ++= Seq(
  "com.typesafe.play"  %% "play" % "2.2.0" % "provided"
)

// Publishing

val localMavenRepo = Path.userHome.absolutePath + "/Projects/maven-atamborrino/"

publishMavenStyle := true

publishTo := {
  if (version.value.trim.endsWith("SNAPSHOT"))
    Some(Resolver.file("snapshots", file(localMavenRepo + "/snapshots")))
  else
    Some(Resolver.file("releases", file(localMavenRepo + "/releases")))
}

// Github publish
lazy val ghPublish = taskKey[Unit]("Publish to your maven github repo")

ghPublish := {
  // Publish to localMavenRepo
  val _ = publish.value
  // Git pull, add, commit and push
  import scala.sys.process._  
  val mavenRepoFile = new java.io.File(localMavenRepo)
  def execute(strings: Seq[String]) = sys.process.Process(strings, mavenRepoFile).!!
  println("\nWe will now publish your local maven repo to Github...")
  execute(Seq("git", "pull"))
  execute(Seq("git", "add", "."))
  if (sys.process.Process("git diff --exit-code", mavenRepoFile).! > 0) {
    val commitMsg = "Publish " + organization.value + "." + name.value + " " + version.value
    execute(Seq("git", "commit",  "-m", commitMsg))
    println(execute(Seq("git", "push")))
    println(organization.value + "." + name.value + " " + version.value + "has been sucessfully published.")
  } else {
    println("Nothing new to publish.")
  }
}

