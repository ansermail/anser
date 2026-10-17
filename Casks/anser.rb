cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.20"
  sha256 arm:   "a261a9f63ddc2e9db911fef010fb64b60529802a054dcd7d25f37a313b081d98",
         intel: "b2ffcde117e960ed5bb5147a7fa310501c377a1adc6f0043cf1ecd584e81def4"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
